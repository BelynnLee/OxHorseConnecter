from pathlib import Path

from app.rag import Chunk, RagStore, iter_chunks


def test_iter_chunks_ignores_build_outputs(tmp_path: Path) -> None:
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "app.py").write_text("def hello():\n    return 'world'\n", encoding="utf-8")
    (tmp_path / "node_modules").mkdir()
    (tmp_path / "node_modules" / "ignored.js").write_text("function ignored() {}", encoding="utf-8")

    chunks = iter_chunks(tmp_path)

    assert [chunk.file for chunk in chunks] == ["src/app.py"]
    assert chunks[0].symbol == "hello"


def test_rag_index_and_query(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "control.py").write_text(
        "class ControlPlane:\n"
        "    def register_project(self):\n"
        "        return 'project registered'\n",
        encoding="utf-8",
    )
    store = RagStore(tmp_path / "chroma")

    result = store.index_repo("project-1", repo)
    query = store.query("project-1", "how do projects register?", top_k=3)

    assert result["indexedFiles"] == 1
    assert result["indexedChunks"] >= 1
    assert query["chunks"]
    assert query["chunks"][0]["file"] == "control.py"


def test_rag_index_chunks(tmp_path: Path) -> None:
    store = RagStore(tmp_path / "chroma")

    result = store.index_chunks(
        "project-remote",
        [
            Chunk(
                file="src/remote.py",
                symbol="RemoteControl",
                content="class RemoteControl:\n    pass\n",
                start_line=1,
                ordinal=0,
            )
        ],
    )
    query = store.query("project-remote", "remote control", top_k=1)

    assert result["indexedFiles"] == 1
    assert query["chunks"][0]["file"] == "src/remote.py"
