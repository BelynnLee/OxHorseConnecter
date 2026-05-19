from __future__ import annotations

import hashlib
import math
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import chromadb


IGNORE_DIRS = {
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "dist",
    "build",
    "target",
    ".venv",
    "venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
}

TEXT_SUFFIXES = {
    ".c",
    ".cc",
    ".cpp",
    ".cs",
    ".css",
    ".go",
    ".h",
    ".hpp",
    ".html",
    ".java",
    ".js",
    ".jsx",
    ".json",
    ".kt",
    ".md",
    ".mdx",
    ".php",
    ".py",
    ".rb",
    ".rs",
    ".sh",
    ".sql",
    ".svelte",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".vue",
    ".xml",
    ".yaml",
    ".yml",
}

SYMBOL_RE = re.compile(
    r"^\s*(?:export\s+)?(?:async\s+)?(?:def|class|function|interface|type|const|let|var)\s+([A-Za-z_][\w$]*)",
    re.MULTILINE,
)


@dataclass(frozen=True)
class Chunk:
    file: str
    symbol: str | None
    content: str
    start_line: int
    ordinal: int


class RagStore:
    def __init__(self, persist_path: str | Path):
        self.persist_path = Path(persist_path)
        self.persist_path.mkdir(parents=True, exist_ok=True)
        self.client = chromadb.PersistentClient(path=str(self.persist_path))

    def collection_name(self, project_id: str) -> str:
        digest = hashlib.sha1(project_id.encode("utf-8")).hexdigest()[:24]
        return f"project_{digest}"

    def get_collection(self, project_id: str) -> Any:
        return self.client.get_or_create_collection(self.collection_name(project_id), metadata={"projectId": project_id})

    def delete_index(self, project_id: str) -> None:
        try:
            self.client.delete_collection(self.collection_name(project_id))
        except Exception:
            return

    def status(self, project_id: str) -> dict[str, Any]:
        try:
            collection = self.get_collection(project_id)
            return {"projectId": project_id, "status": "ready", "indexedChunks": collection.count()}
        except Exception as exc:
            return {"projectId": project_id, "status": "failed", "error": str(exc), "indexedChunks": 0}

    def index_repo(self, project_id: str, project_path: str | Path) -> dict[str, Any]:
        root = Path(project_path).resolve()
        if not root.exists() or not root.is_dir():
            raise ValueError("Project path must be an existing directory.")

        return self.index_chunks(project_id, list(iter_chunks(root)))

    def index_chunks(self, project_id: str, chunks: list[Chunk]) -> dict[str, Any]:
        self.delete_index(project_id)
        collection = self.get_collection(project_id)
        if not chunks:
            return {"projectId": project_id, "status": "ready", "indexedFiles": 0, "indexedChunks": 0}

        ids: list[str] = []
        documents: list[str] = []
        embeddings: list[list[float]] = []
        metadatas: list[dict[str, Any]] = []
        indexed_files: set[str] = set()

        for chunk in chunks:
            chunk_id = hashlib.sha1(f"{project_id}:{chunk.file}:{chunk.ordinal}".encode("utf-8")).hexdigest()
            ids.append(chunk_id)
            documents.append(chunk.content)
            embeddings.append(embed_text(chunk.content))
            metadatas.append({
                "file": chunk.file,
                "symbol": chunk.symbol or "",
                "startLine": chunk.start_line,
            })
            indexed_files.add(chunk.file)

        for start in range(0, len(ids), 256):
            end = start + 256
            collection.add(
                ids=ids[start:end],
                documents=documents[start:end],
                embeddings=embeddings[start:end],
                metadatas=metadatas[start:end],
            )

        return {
            "projectId": project_id,
            "status": "ready",
            "indexedFiles": len(indexed_files),
            "indexedChunks": len(chunks),
        }

    def query(self, project_id: str, query: str, top_k: int = 6) -> dict[str, Any]:
        collection = self.get_collection(project_id)
        if collection.count() == 0:
            return {"chunks": []}

        result = collection.query(
            query_embeddings=[embed_text(query)],
            n_results=max(1, min(top_k, 30)),
            include=["documents", "metadatas", "distances"],
        )
        documents = result.get("documents", [[]])[0]
        metadatas = result.get("metadatas", [[]])[0]
        distances = result.get("distances", [[]])[0]
        chunks: list[dict[str, Any]] = []
        for document, metadata, distance in zip(documents, metadatas, distances):
            metadata = metadata or {}
            chunks.append({
                "file": metadata.get("file", ""),
                "symbol": metadata.get("symbol") or None,
                "content": document,
                "score": 1.0 / (1.0 + float(distance or 0.0)),
            })
        return {"chunks": chunks}


def iter_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for current, dirs, names in os.walk(root):
        dirs[:] = [name for name in dirs if name not in IGNORE_DIRS and not name.startswith(".cache")]
        for name in names:
            path = Path(current) / name
            if path.suffix.lower() in TEXT_SUFFIXES and path.stat().st_size <= 1_000_000:
                files.append(path)
    return files


def read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        try:
            return path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            return None
    except OSError:
        return None


def symbol_for(content: str) -> str | None:
    match = SYMBOL_RE.search(content)
    return match.group(1) if match else None


def iter_chunks(root: Path, chunk_size: int = 1800, overlap: int = 200) -> list[Chunk]:
    chunks: list[Chunk] = []
    for file_path in iter_files(root):
        text = read_text(file_path)
        if not text or not text.strip():
            continue
        relative = file_path.relative_to(root).as_posix()
        ordinal = 0
        cursor = 0
        while cursor < len(text):
            content = text[cursor:cursor + chunk_size].strip()
            if content:
                start_line = text[:cursor].count("\n") + 1
                chunks.append(Chunk(
                    file=relative,
                    symbol=symbol_for(content),
                    content=content,
                    start_line=start_line,
                    ordinal=ordinal,
                ))
                ordinal += 1
            cursor += max(1, chunk_size - overlap)
    return chunks


def embed_text(text: str, dimensions: int = 256) -> list[float]:
    vector = [0.0] * dimensions
    for token in re.findall(r"[A-Za-z_][A-Za-z0-9_]{1,}", text.lower()):
        digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
        index = int.from_bytes(digest[:4], "big") % dimensions
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vector[index] += sign
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [value / norm for value in vector]
