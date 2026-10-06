"""Local sentence embeddings behind LangChain's `Embeddings` interface.

LangChain is used here for a concrete architectural reason: the same `Embeddings`
object drives (a) bulk pipeline embedding, (b) the PGVector store and retriever used
for "similar feedback", and (c) embedding of newly uploaded CSV rows. Swapping the model
is a one-line config change.
"""
from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path

import numpy as np
from langchain_huggingface import HuggingFaceEmbeddings

from ml import config


@lru_cache(maxsize=1)
def get_embedder(model_name: str = config.EMBEDDING_MODEL) -> HuggingFaceEmbeddings:
    return HuggingFaceEmbeddings(
        model_name=model_name,
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True, "batch_size": 128},
    )


def embed_texts(texts: list[str], embedder=None) -> np.ndarray:
    """Return an (n, dim) float32 array of L2-normalized embeddings."""
    embedder = embedder or get_embedder()
    if not texts:
        return np.zeros((0, config.EMBEDDING_DIM), dtype=np.float32)
    return np.asarray(embedder.embed_documents(list(texts)), dtype=np.float32)


def embed_with_cache(ids: list[str], texts: list[str], cache_dir: Path = config.CACHE_DIR, embedder=None) -> np.ndarray:
    """Embed texts, caching to disk keyed by a hash of ids+model so reruns are instant."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1((config.EMBEDDING_MODEL + "|" + "|".join(ids)).encode()).hexdigest()[:12]
    path = cache_dir / f"emb_{key}.npy"
    if path.exists():
        return np.load(path)
    # Resumable: each chunk is checkpointed, so an interrupted run continues where it stopped.
    parts_dir = cache_dir / f"parts_{key}"
    parts_dir.mkdir(exist_ok=True)
    chunk, parts = 4096, []
    for n, start in enumerate(range(0, len(texts), chunk)):
        part = parts_dir / f"{n:05d}.npy"
        if not part.exists():
            np.save(part, embed_texts(texts[start:start + chunk], embedder))
            print(f"  embedded {min(start + chunk, len(texts)):,}/{len(texts):,}", flush=True)
        parts.append(part)
    emb = np.vstack([np.load(p) for p in parts]) if parts else embed_texts([], embedder)
    np.save(path, emb)
    for p in parts:
        p.unlink()
    parts_dir.rmdir()
    return emb


def cosine_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Cosine similarity between rows of a and b (re-normalizes defensively)."""
    a = a / np.clip(np.linalg.norm(a, axis=1, keepdims=True), 1e-12, None)
    b = b / np.clip(np.linalg.norm(b, axis=1, keepdims=True), 1e-12, None)
    return a @ b.T
