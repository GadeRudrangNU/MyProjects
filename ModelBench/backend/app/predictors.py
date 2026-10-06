"""Model backends. `keyword:` ids are a tiny dependency-free baseline (used in tests/demo);
anything else is loaded as a Hugging Face text-classification pipeline on CPU."""
import threading
from functools import lru_cache
from typing import Protocol

DEFAULT_LABEL_MAP = {
    "POSITIVE": "positive", "NEGATIVE": "negative",
    "LABEL_1": "positive", "LABEL_0": "negative",
    "POS": "positive", "NEG": "negative",
}

POSITIVE_WORDS = {"good", "great", "love", "excellent", "amazing", "wonderful", "best", "fantastic", "enjoyed", "perfect", "brilliant"}
NEGATIVE_WORDS = {"bad", "terrible", "hate", "awful", "worst", "boring", "poor", "disappointing", "waste", "horrible", "broken"}


class Predictor(Protocol):
    def predict(self, texts: list[str]) -> list[dict]: ...


class KeywordPredictor:
    def predict(self, texts: list[str]) -> list[dict]:
        out = []
        for text in texts:
            words = {w.strip(".,!?;:'\"").lower() for w in text.split()}
            score = len(words & POSITIVE_WORDS) - len(words & NEGATIVE_WORDS)
            label = "positive" if score >= 0 else "negative"
            out.append({"label": label, "score": min(1.0, 0.5 + abs(score) * 0.15)})
        return out


class HFPredictor:
    def __init__(self, hf_id: str, label_map: dict[str, str]):
        from transformers import pipeline  # imported lazily: torch is heavy

        self._pipe = pipeline("text-classification", model=hf_id, device=-1)
        self._map = {**DEFAULT_LABEL_MAP, **label_map}

    def predict(self, texts: list[str]) -> list[dict]:
        results = self._pipe(texts, truncation=True, max_length=256)
        return [{"label": self._map.get(r["label"], r["label"].lower()), "score": float(r["score"])} for r in results]


@lru_cache(maxsize=4)
def _load(hf_id: str, label_items: tuple) -> Predictor:
    if hf_id.startswith("keyword:"):
        return KeywordPredictor()
    return HFPredictor(hf_id, dict(label_items))


_LOAD_LOCK = threading.Lock()  # transformers' lazy imports are not thread-safe


def get_predictor(hf_id: str, label_map: dict | None = None) -> Predictor:
    with _LOAD_LOCK:
        return _load(hf_id, tuple(sorted((label_map or {}).items())))
