"""FastAPI REST API.

Data comes from the newest snapshot in Postgres. If the database is unreachable the API falls back
to the JSON file named by WROOM_SNAPSHOT (default: frontend/public/snapshot.json, written by
`wroomcheck demo`), so the dashboard works without Docker. /api/ask and /api/search need the DB.
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .config import get_settings

app = FastAPI(title="WroomCheck API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_cache: dict = {}


def _snapshot() -> dict:
    if "doc" in _cache:
        return _cache["doc"]
    doc = None
    try:
        from . import db

        with db.connect(get_settings().database_url) as conn:
            doc = db.load_snapshot(conn)
    except Exception:
        pass
    if doc is None:
        path = Path(os.environ.get("WROOM_SNAPSHOT", "frontend/public/snapshot.json"))
        if path.exists():
            doc = json.loads(path.read_text(encoding="utf-8"))
    if doc is None:
        raise HTTPException(503, "No results yet. Run `wroomcheck demo` or `wroomcheck detect` first.")
    _cache["doc"] = doc
    return doc


@lru_cache(maxsize=1)
def _embedder():
    from .embeddings import get_embedder

    return get_embedder(get_settings().embedder)


@lru_cache(maxsize=1)
def _qa_llm():
    st = get_settings()
    if st.llm != "ollama":
        return None
    from .rag import build_qa_chain

    return build_qa_chain(st.ollama_model, st.ollama_url)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/reload")
def reload() -> dict:
    _cache.clear()
    return {"alerts": len(_snapshot()["alerts"])}


@app.get("/api/meta")
def meta() -> dict:
    s = _snapshot()
    pairs = sorted({(a["make"], a["model"]) for a in s["alerts"]} | {(c["make"], c["model"]) for c in s["campaigns"]})
    return {
        **s["meta"], "generated_at": s["generated_at"],
        "makes": sorted({m for m, _ in pairs}),
        "models": [{"make": m, "model": mo} for m, mo in pairs],
        "components": sorted({a["component"] for a in s["alerts"]}),
    }


@app.get("/api/metrics")
def metrics() -> dict:
    return _snapshot()["metrics"]


@app.get("/api/alerts")
def alerts(
    make: str | None = None,
    model: str | None = None,
    component: str | None = None,
    outcome: str | None = None,
    limit: int = Query(200, le=1000),
) -> list[dict]:
    rows = [
        a for a in _snapshot()["alerts"]
        if (not make or a["make"] == make.upper()) and (not model or a["model"] == model.upper())
        and (not component or a["component"] == component.upper()) and (not outcome or a["outcome"] == outcome)
    ]
    slim = ("evidence", "timeline")  # list view omits heavy fields; fetch /api/alerts/{id} for detail
    return [{k: v for k, v in a.items() if k not in slim} for a in rows[:limit]]


@app.get("/api/alerts/{alert_id}")
def alert_detail(alert_id: int) -> dict:
    for a in _snapshot()["alerts"]:
        if a["id"] == alert_id:
            return a
    raise HTTPException(404, "alert not found")


@app.get("/api/campaigns")
def campaigns(status: str | None = None, make: str | None = None, model: str | None = None) -> list[dict]:
    return [
        c for c in _snapshot()["campaigns"]
        if (not status or c["status"] == status) and (not make or c["make"] == make.upper())
        and (not model or c["model"] == model.upper())
    ]


class AskRequest(BaseModel):
    question: str
    make: str | None = None
    model: str | None = None
    k: int = 8


@app.post("/api/ask")
def ask(req: AskRequest) -> dict:
    from . import db, rag

    try:
        with db.connect(get_settings().database_url) as conn:
            return rag.ask(conn, _embedder(), req.question, req.make, req.model, req.k, _qa_llm())
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(503, f"RAG needs Postgres with embedded complaints ({exc})") from exc
