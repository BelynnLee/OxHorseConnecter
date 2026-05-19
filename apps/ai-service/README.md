# CodeAgent AI Service

Local FastAPI service for the CodeAgent Control Plane. The first implementation covers repository RAG indexing/query with Chroma persistence plus lightweight evaluation and failure-analysis helper endpoints.

Run locally:

```powershell
uv run --project apps/ai-service uvicorn app.main:app --host 127.0.0.1 --port 8010
```

Test:

```powershell
uv run --project apps/ai-service pytest
```

By default Chroma persists to `data/chroma`. Override with `CHROMA_PATH`.
