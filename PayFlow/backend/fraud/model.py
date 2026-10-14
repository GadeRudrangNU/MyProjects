"""Serving side of the fraud model.

The model is trained offline (``ml/train_fraud_model.py``) and exported as plain JSON
(standardiser parameters + logistic-regression coefficients), so serving needs neither
scikit-learn nor pickle: scoring one transaction is a dot product.
"""

import json
import math
from collections.abc import Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

ARTIFACT_PATH = Path(__file__).resolve().parent / "artifacts" / "fraud_model.json"
SIGNAL_COUNT = 28  # V1..V28: anonymised behavioural components supplied by an upstream provider


@dataclass(frozen=True)
class FraudModel:
    features: tuple[str, ...]
    mean: tuple[float, ...]
    scale: tuple[float, ...]
    coef: tuple[float, ...]
    intercept: float
    review_threshold: float
    block_threshold: float
    metrics: dict

    def predict_proba(self, signals: Sequence[float], amount_cents: int) -> float:
        """Probability that the transaction is fraudulent."""
        if len(signals) != SIGNAL_COUNT:
            raise ValueError(f"expected {SIGNAL_COUNT} risk signals, got {len(signals)}")
        row = [*signals, math.log1p(amount_cents / 100)]
        z = self.intercept
        for x, mu, sd, w in zip(row, self.mean, self.scale, self.coef, strict=True):
            z += w * (x - mu) / (sd or 1.0)
        if z >= 0:
            return 1.0 / (1.0 + math.exp(-z))
        e = math.exp(z)
        return e / (1.0 + e)


@lru_cache(maxsize=1)
def load_model(path: str | None = None) -> FraudModel | None:
    artifact = Path(path) if path else ARTIFACT_PATH
    if not artifact.exists():
        return None
    data = json.loads(artifact.read_text())
    return FraudModel(
        features=tuple(data["features"]),
        mean=tuple(data["mean"]),
        scale=tuple(data["scale"]),
        coef=tuple(data["coef"]),
        intercept=float(data["intercept"]),
        review_threshold=float(data["review_threshold"]),
        block_threshold=float(data["block_threshold"]),
        metrics=data.get("metrics", {}),
    )
