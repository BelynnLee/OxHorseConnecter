from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .analysis import analyze_failure, analyze_session, evaluate_prompt_versions
from .rag import Chunk, RagStore


def default_chroma_path() -> Path:
    return Path(os.getenv("CHROMA_PATH", Path(__file__).resolve().parents[3] / "data" / "chroma"))


store = RagStore(default_chroma_path())
app = FastAPI(title="CodeAgent AI Service", version="0.2.0")


class IndexRepoRequest(BaseModel):
    project_id: str = Field(alias="projectId")
    path: str


class IndexChunk(BaseModel):
    file: str
    symbol: str | None = None
    content: str
    start_line: int = Field(alias="startLine")
    ordinal: int


class IndexChunksRequest(BaseModel):
    project_id: str = Field(alias="projectId")
    chunks: list[IndexChunk]


class QueryRequest(BaseModel):
    project_id: str = Field(alias="projectId")
    query: str
    top_k: int = Field(default=6, alias="topK", ge=1, le=30)


class DeleteIndexRequest(BaseModel):
    project_id: str = Field(alias="projectId")


class AnalyzeSessionRequest(BaseModel):
    session_id: str | None = Field(default=None, alias="sessionId")
    transcript: str = ""
    expected: dict[str, Any] = Field(default_factory=dict)
    diff_files: list[str] = Field(default_factory=list, alias="diffFiles")
    commands: list[dict[str, Any]] = Field(default_factory=list)
    duration_ms: int | None = Field(default=None, alias="durationMs")


class FailureAnalysisRequest(BaseModel):
    session_id: str | None = Field(default=None, alias="sessionId")
    logs: str = ""
    error: str | None = None
    commands: list[dict[str, Any]] = Field(default_factory=list)
    events: list[dict[str, Any]] = Field(default_factory=list)


class PromptEvalRequest(BaseModel):
    runs: list[dict[str, Any]] = Field(default_factory=list)


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "codeagent-ai-service", "chromaPath": str(store.persist_path)}


@app.post("/rag/index-repo")
def index_repo(request: IndexRepoRequest) -> dict[str, Any]:
    try:
        return store.index_repo(request.project_id, request.path)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/rag/index-chunks")
def index_chunks(request: IndexChunksRequest) -> dict[str, Any]:
    try:
        return store.index_chunks(
            request.project_id,
            [
                Chunk(
                    file=chunk.file,
                    symbol=chunk.symbol,
                    content=chunk.content,
                    start_line=chunk.start_line,
                    ordinal=chunk.ordinal,
                )
                for chunk in request.chunks
            ],
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/rag/query")
def query(request: QueryRequest) -> dict[str, Any]:
    try:
        return store.query(request.project_id, request.query, request.top_k)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/rag/delete-index")
def delete_index(request: DeleteIndexRequest) -> dict[str, Any]:
    store.delete_index(request.project_id)
    return {"ok": True}


@app.get("/rag/status/{project_id}")
def rag_status(project_id: str) -> dict[str, Any]:
    return store.status(project_id)


@app.post("/evals/analyze-session")
def analyze_session_endpoint(request: AnalyzeSessionRequest) -> dict[str, Any]:
    return analyze_session(
        session_id=request.session_id,
        transcript=request.transcript,
        expected=request.expected,
        diff_files=request.diff_files,
        commands=request.commands,
        duration_ms=request.duration_ms,
    )


@app.post("/evals/prompt-versions")
def prompt_versions(request: PromptEvalRequest) -> dict[str, Any]:
    return evaluate_prompt_versions(runs=request.runs)


@app.post("/analyze/failure")
def analyze_failure_endpoint(request: FailureAnalysisRequest) -> dict[str, Any]:
    return analyze_failure(
        session_id=request.session_id,
        logs=request.logs,
        error=request.error,
        commands=request.commands,
        events=request.events,
    )
