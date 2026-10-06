import threading
import time

from . import db
from .datasets import load_dataset
from .metrics import classification_metrics, percentile
from .models import MLModel, Run, utcnow
from .observability import RUNS_TOTAL
from .predictors import get_predictor


# One evaluation at a time: concurrent runs would fight for CPU and inflate each other's latency.
_EVAL_LOCK = threading.Lock()


def evaluate(model: MLModel, dataset_rows: list[dict]) -> dict:
    predictor = get_predictor(model.hf_id, model.label_map)
    predictor.predict([dataset_rows[0]["text"]])  # warm-up so load time isn't counted as latency

    preds, latencies_ms = [], []
    started = time.perf_counter()
    for row in dataset_rows:
        t0 = time.perf_counter()
        preds.append(predictor.predict([row["text"]])[0]["label"])
        latencies_ms.append((time.perf_counter() - t0) * 1000)
    wall = time.perf_counter() - started

    result = classification_metrics([r["label"] for r in dataset_rows], preds)
    result["latency_ms"] = {
        "p50": round(percentile(latencies_ms, 50), 2),
        "p95": round(percentile(latencies_ms, 95), 2),
        "mean": round(sum(latencies_ms) / len(latencies_ms), 2),
    }
    result["throughput_per_s"] = round(len(dataset_rows) / wall, 2) if wall else 0.0
    return result


def run_evaluation(run_id: int) -> None:
    """Background task: owns its own session because the request session is closed by then."""
    session = db.SessionLocal()
    try:
        run = session.get(Run, run_id)
        run.status = "running"
        session.commit()
        try:
            with _EVAL_LOCK:
                run.metrics = evaluate(run.model, load_dataset(run.dataset))
            run.status = "completed"
        except Exception as exc:  # surfaced in the UI instead of lost in logs
            run.status, run.error = "failed", f"{type(exc).__name__}: {exc}"
        run.finished_at = utcnow()
        RUNS_TOTAL.labels(status=run.status).inc()
        session.commit()
    finally:
        session.close()
