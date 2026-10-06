from __future__ import annotations

import numpy as np
from sklearn.linear_model import LogisticRegression


def _logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(np.asarray(p, dtype=float), 1e-4, 1 - 1e-4)
    return np.log(p / (1 - p)).reshape(-1, 1)


class SigmoidCalibrator:
    def fit(self, raw: np.ndarray, y: np.ndarray) -> "SigmoidCalibrator":
        self.lr_ = LogisticRegression(C=1e6, max_iter=1000).fit(_logit(raw), y)
        return self

    def predict(self, raw: np.ndarray) -> np.ndarray:
        return self.lr_.predict_proba(_logit(raw))[:, 1]
