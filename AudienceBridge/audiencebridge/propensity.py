from __future__ import annotations

import logging
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from . import bq
from .config import ClientConfig, Settings

log = logging.getLogger("audiencebridge")

NUMERIC = ["sessions", "item_views", "add_to_carts", "purchases", "revenue_usd", "days_since_last_seen"]
CATEGORICAL = ["device_category", "country"]


def _record_evaluation(client, settings: Settings, row: dict) -> None:
    frame = pd.DataFrame([{**row, "run_at": datetime.now(timezone.utc)}])
    bq.load_df(client, frame, bq.table_id(settings, "measurement", "model_evaluation"))


def train_bqml(client, settings: Settings, cfg: ClientConfig) -> dict:
    bq.run_sql_file(client, settings, cfg, "ml/train_model.sql")
    metrics = bq.query_file_df(client, settings, cfg, "ml/evaluate.sql").iloc[0].to_dict()
    bq.run_sql_file(client, settings, cfg, "ml/score.sql")
    return {"backend": "bqml", **{k: float(v) for k, v in metrics.items()}}


def train_sklearn(client, settings: Settings, cfg: ClientConfig) -> dict:
    from sklearn.compose import ColumnTransformer
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import accuracy_score, f1_score, log_loss, precision_score, recall_score, roc_auc_score
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import OneHotEncoder, StandardScaler

    data = bq.query_df(client, f"SELECT * FROM `{bq.table_id(settings, 'marts', 'training_set')}`")
    data[NUMERIC] = np.log1p(data[NUMERIC].clip(lower=0).astype(float))
    top = data["country"].value_counts().head(20).index
    data["country"] = data["country"].where(data["country"].isin(top), "other")

    features = NUMERIC + CATEGORICAL
    pre = ColumnTransformer([("num", StandardScaler(), NUMERIC), ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL)])
    model = make_pipeline(pre, LogisticRegression(class_weight="balanced", max_iter=1000))
    is_eval = data["is_eval"].astype(bool)
    train, test = data[~is_eval], data[is_eval]
    model.fit(train[features], train["purchased_next_month"].astype(int))

    proba = model.predict_proba(test[features])[:, 1]
    label = test["purchased_next_month"].astype(int)
    pred = (proba >= 0.5).astype(int)
    metrics = {
        "backend": "sklearn",
        "precision": float(precision_score(label, pred, zero_division=0)),
        "recall": float(recall_score(label, pred, zero_division=0)),
        "accuracy": float(accuracy_score(label, pred)),
        "f1_score": float(f1_score(label, pred, zero_division=0)),
        "log_loss": float(log_loss(label, proba, labels=[0, 1])),
        "roc_auc": float(roc_auc_score(label, proba)),
    }
    scores = pd.DataFrame(
        {"user_pseudo_id": data["user_pseudo_id"], "propensity_score": model.predict_proba(data[features])[:, 1]}
    )
    bq.load_df(client, scores, bq.table_id(settings, "marts", "propensity_scores"))
    return metrics


def build(client, settings: Settings, cfg: ClientConfig) -> dict | None:
    if not cfg.propensity_enabled:
        return None
    bq.run_sql_file(client, settings, cfg, "marts/training_set.sql")
    if cfg.propensity_backend == "bqml":
        try:
            metrics = train_bqml(client, settings, cfg)
        except Exception as exc:
            log.warning("BigQuery ML failed (%s); falling back to scikit-learn", exc)
            metrics = train_sklearn(client, settings, cfg)
    else:
        metrics = train_sklearn(client, settings, cfg)
    _record_evaluation(client, settings, metrics)
    return metrics
