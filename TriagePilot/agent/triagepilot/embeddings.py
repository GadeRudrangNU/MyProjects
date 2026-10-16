import hashlib
import re

import numpy as np

from .config import Settings


class HashEmbedder:
    """Deterministic bag-of-words hashing embedder, used by tests and CI."""

    def __init__(self, dim: int = 384):
        self.dim = dim

    def encode(self, texts: list[str]) -> np.ndarray:
        out = np.zeros((len(texts), self.dim), dtype=np.float32)
        for i, text in enumerate(texts):
            for tok in re.findall(r"[a-z0-9]+", text.lower()):
                h = int(hashlib.md5(tok.encode()).hexdigest()[:8], 16)
                out[i, h % self.dim] += 1.0 if (h >> 31) & 1 else -1.0
        norms = np.linalg.norm(out, axis=1, keepdims=True)
        norms[norms == 0] = 1
        return out / norms


class SbertEmbedder:
    def __init__(self, name: str):
        from sentence_transformers import SentenceTransformer

        self.model = SentenceTransformer(name, device="cpu")
        self.dim = getattr(self.model, "get_embedding_dimension", self.model.get_sentence_embedding_dimension)()

    def encode(self, texts: list[str]) -> np.ndarray:
        return self.model.encode(texts, batch_size=128, normalize_embeddings=True, show_progress_bar=False).astype(np.float32)


def get_embedder(settings: Settings):
    if settings.embedder == "hash":
        return HashEmbedder()
    return SbertEmbedder(settings.embedding_model)
