from pathlib import Path

import joblib
import numpy as np

from .textprep import normalize


class TicketClassifier:
    def __init__(self, pipeline):
        self.pipeline = pipeline
        self.classes: list[str] = list(pipeline.classes_)

    @classmethod
    def load(cls, path: Path) -> "TicketClassifier":
        return cls(joblib.load(path))

    def predict_proba(self, texts: list[str]) -> np.ndarray:
        return self.pipeline.predict_proba([normalize(t) for t in texts])

    def top_k(self, text: str, k: int = 3) -> list[tuple[str, float]]:
        probs = self.predict_proba([text])[0]
        order = np.argsort(-probs)[:k]
        return [(self.classes[i], float(probs[i])) for i in order]
