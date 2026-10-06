"""Text embedders. Both return L2-normalised float32 vectors of EMBED_DIM."""
from __future__ import annotations

import re
import zlib
from typing import Protocol, Sequence

import numpy as np

from .config import EMBED_DIM

_TOKEN = re.compile(r"[a-z]{3,}")
_STOP = frozenset(
    """the and was were that this with for from had has have not but when then they them their there
    would could out got get into after before while about been being are our its his her she him you your
    vehicle car truck van suv dealer dealership mile miles year years time times told said stated""".split()
)


_BOILERPLATE = re.compile(
    r"THE CONTACT (?:OWNS|OWNED|LEASES|LEASED) (?:AN? )?[^.]{0,80}\.|THE CONSUMER (?:OWNS|OWNED) (?:AN? )?[^.]{0,80}\."
    r"|THE (?:CONTACT|CONSUMER) (?:STATED|STATES|EXPERIENCED|INDICATED|ALSO STATED)(?: THAT)?"
    r"|\bTHE (?:VEHICLE|MANUFACTURER|DEALER|LOCAL DEALER)\b|\bNHTSA\b|\bVIN\b[^.]{0,30}",
    re.IGNORECASE,
)


def prepare_text(text: str) -> str:
    """Strip NHTSA's templated intake phrases so clusters form around the defect, not the form."""
    return _BOILERPLATE.sub(" ", text)


class Embedder(Protocol):
    name: str
    default_threshold: float  # cosine threshold for joining a cluster

    def encode(self, texts: Sequence[str]) -> np.ndarray: ...


class HashingEmbedder:
    """Dependency-free hashed bag of unigrams+bigrams. Good enough for demos and tests."""

    name = "hashing"
    default_threshold = 0.5

    def encode(self, texts: Sequence[str]) -> np.ndarray:
        out = np.zeros((len(texts), EMBED_DIM), dtype=np.float32)
        for i, text in enumerate(texts):
            words = [w for w in _TOKEN.findall(text.lower()) if w not in _STOP]
            grams = words + [f"{a}_{b}" for a, b in zip(words, words[1:])]
            for g in grams:
                h = zlib.crc32(g.encode())
                out[i, h % EMBED_DIM] += 1.0 if (h >> 16) & 1 else -1.0
        out = np.sign(out) * np.sqrt(np.abs(out))  # sublinear term weighting
        norms = np.linalg.norm(out, axis=1, keepdims=True)
        return out / np.maximum(norms, 1e-9)


class MiniLMEmbedder:
    """sentence-transformers all-MiniLM-L6-v2: free, local, 384-d."""

    name = "minilm"
    default_threshold = 0.55

    def __init__(
        self, model_name: str = "sentence-transformers/all-MiniLM-L6-v2", batch_size: int = 64, max_tokens: int = 128
    ):
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:  # pragma: no cover
            raise SystemExit(
                "sentence-transformers is not installed. Run: pip install -e '.[embed]' "
                "or set WROOM_EMBEDDER=hashing"
            ) from exc
        self._model = SentenceTransformer(model_name)
        # The first ~128 tokens carry the defect description; truncating halves CPU time.
        self._model.max_seq_length = max_tokens
        self._batch = batch_size

    def encode(self, texts: Sequence[str]) -> np.ndarray:
        vecs = self._model.encode(
            list(texts), batch_size=self._batch, normalize_embeddings=True, show_progress_bar=False
        )
        return np.asarray(vecs, dtype=np.float32)


def get_embedder(name: str) -> Embedder:
    if name == "hashing":
        return HashingEmbedder()
    if name == "minilm":
        return MiniLMEmbedder()
    raise ValueError(f"unknown embedder {name!r} (use 'minilm' or 'hashing')")
