"""Local semantic similarity with a TF-IDF fallback"""
from __future__ import annotations

import hashlib
import logging
import re

import numpy as np

from ..config import settings

log = logging.getLogger("coopcompass.embeddings")

_STOP = set("""a an and are as at be by for from has have in is it of on or that the to with you your our we will this these
those they their i he she can able etc using use used including include such who what which when where within across
experience work working team teams role position job candidate strong good great new""".split())

_model = None
_model_failed = False
_cache: dict[str, np.ndarray] = {}


def _tokens(text: str) -> list[str]:
    out = []
    for t in re.findall(r"[a-z0-9+#.]+", text.lower()):
        t = t.strip(".")
        if not t or t in _STOP or len(t) < 2:
            continue
        for suf in ("ing", "ers", "er", "ists", "ist", "ics", "ies", "es", "s", "ed"):
            if len(t) > len(suf) + 3 and t.endswith(suf):
                t = t[: -len(suf)]
                break
        out.append(t)
    return out


def _load_model():
    global _model, _model_failed
    if _model is not None or _model_failed:
        return _model
    want = settings.embedding_backend
    if want in {"tfidf", "local-tfidf"}:
        _model_failed = True
        return None
    try:
        from sentence_transformers import SentenceTransformer

        _model = SentenceTransformer(settings.embedding_model)
        log.info("Loaded sentence-transformers model %s", settings.embedding_model)
    except Exception as exc:
        _model_failed = True
        log.warning("sentence-transformers unavailable (%s); using TF-IDF fallback", type(exc).__name__)
    return _model


def backend_name() -> str:
    return "sentence-transformers" if _load_model() is not None else "tfidf"


def reset() -> None:
    global _model, _model_failed
    _model, _model_failed = None, False
    _cache.clear()


def _embed_st(texts: list[str]) -> np.ndarray:
    model = _load_model()
    missing = [t for t in texts if hashlib.md5(t.encode()).hexdigest() not in _cache]
    if missing:
        vecs = model.encode(missing, normalize_embeddings=True, show_progress_bar=False)
        for t, v in zip(missing, vecs):
            _cache[hashlib.md5(t.encode()).hexdigest()] = np.asarray(v)
    return np.vstack([_cache[hashlib.md5(t.encode()).hexdigest()] for t in texts])


def similarity_matrix(a: list[str], b: list[str]) -> np.ndarray:
    if not a or not b:
        return np.zeros((len(a), len(b)))
    if _load_model() is not None:
        va, vb = _embed_st(a), _embed_st(b)
        return np.clip(va @ vb.T, 0, 1)
    from sklearn.feature_extraction.text import TfidfVectorizer

    docs = [" ".join(_tokens(t)) or "empty" for t in a + b]
    vec = TfidfVectorizer(token_pattern=r"[^ ]+", sublinear_tf=True)
    m = vec.fit_transform(docs)
    va, vb = m[: len(a)], m[len(a):]
    return (va @ vb.T).toarray()


def similarity(a: str, b: str) -> float:
    return float(similarity_matrix([a], [b])[0, 0])


def to_fraction(sim: float) -> float:
    lo, hi = (0.25, 0.70) if backend_name() == "sentence-transformers" else (0.05, 0.55)
    return float(min(1.0, max(0.0, (sim - lo) / (hi - lo))))


def evidence_threshold() -> tuple[float, float]:
    return (0.35, 0.55) if backend_name() == "sentence-transformers" else (0.20, 0.40)
