"""pgvector access through LangChain's `PGVector` store.

* similar feedback  -> `similarity_search_with_score_by_vector` using the stored vector (no model load)
* semantic search   -> LangChain retriever (`as_retriever().invoke(query)`), embeds the query locally
* new uploads       -> `add_embeddings` with vectors computed by the same local embedder
"""
from __future__ import annotations

import json

from langchain_postgres import PGVector
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.app import config
from backend.app.db import get_engine, sync_url_for_langchain

_stores: dict[int, PGVector] = {}


def get_vector_store(embedder=None) -> PGVector:
    """One store per (engine, embedder). `embedder` defaults to the local MiniLM model (lazy)."""
    engine = get_engine()
    key = (id(engine), id(embedder))
    if key not in _stores:
        if embedder is None:
            from ml.embeddings import get_embedder
            embedder = get_embedder()
        _stores[key] = PGVector(
            embeddings=embedder,
            collection_name=config.COLLECTION_NAME,
            connection=sync_url_for_langchain(engine),
            use_jsonb=True,
        )
    return _stores[key]


def reset_store(embedder=None) -> PGVector:
    store = get_vector_store(embedder)
    store.delete_collection()
    store.create_collection()
    return store


def add_vectors(store: PGVector, ids: list[str], texts: list[str], vectors, metadatas: list[dict], batch: int = 2000) -> None:
    for i in range(0, len(ids), batch):
        store.add_embeddings(
            texts=texts[i:i + batch],
            embeddings=[list(map(float, v)) for v in vectors[i:i + batch]],
            metadatas=metadatas[i:i + batch],
            ids=ids[i:i + batch],
        )


def fetch_vector(session: Session, feedback_id: str) -> list[float] | None:
    row = session.execute(
        text("SELECT embedding::text FROM langchain_pg_embedding WHERE id = :id"), {"id": feedback_id}
    ).first()
    return None if row is None else json.loads(row[0])


def similar_feedback(session: Session, store: PGVector, feedback_id: str, k: int = 6) -> list[dict]:
    vec = fetch_vector(session, feedback_id)
    if vec is None:
        return []
    hits = store.similarity_search_with_score_by_vector(vec, k=k + 1)
    out = []
    for doc, dist in hits:
        fid = doc.metadata.get("feedback_id")
        if fid == feedback_id:
            continue
        out.append({"feedback_id": fid, "text": doc.page_content, "similarity": round(1.0 - float(dist), 4)})
    return out[:k]


def semantic_search(store: PGVector, query: str, k: int = 10) -> list[dict]:
    retriever = store.as_retriever(search_type="similarity", search_kwargs={"k": k})
    return [{"feedback_id": d.metadata.get("feedback_id"), "text": d.page_content} for d in retriever.invoke(query)]
