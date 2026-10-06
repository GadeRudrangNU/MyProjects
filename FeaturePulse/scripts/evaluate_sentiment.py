"""Compare sentiment options against genuine star-rating labels (a bootstrapped, dataset-provided signal).

Ground truth: rating <= 2 -> negative, rating >= 4 -> positive (3-star reviews are ambiguous and excluded).
This measures agreement with *how users rated*, not hand-labeled sentiment, so it is a proxy -- documented as such.

Usage:  python scripts/evaluate_sentiment.py [--n 3000]
Writes: reports/sentiment_evaluation.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, f1_score

from ml import config, sentiment


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=3000)
    a = ap.parse_args()
    df = pd.read_parquet(config.DATA_DIR / "processed" / "feedback.parquet")
    df = df[(df.rating <= 2) | (df.rating >= 4)]
    df = df.sample(min(a.n, len(df)), random_state=config.RANDOM_SEED)
    y = (df.rating >= 4).astype(int).values  # 1 = positive
    texts = df.text.tolist()

    out = {"n_evaluated": len(df), "label_source": "dataset star rating (<=2 negative, >=4 positive)",
           "positive_share": round(float(y.mean()), 4), "majority_class_accuracy": round(float(max(y.mean(), 1 - y.mean())), 4)}

    t = time.time()
    v = np.array([sentiment.vader_score(x) for x in texts])
    vt = time.time() - t
    pred = (v > 0).astype(int)
    out["vader"] = {"accuracy": round(accuracy_score(y, pred), 4), "macro_f1": round(f1_score(y, pred, average="macro"), 4),
                    "texts_per_second": round(len(texts) / vt), "model_download_mb": 0}

    try:
        from transformers import pipeline
        clf = pipeline("sentiment-analysis", model="distilbert/distilbert-base-uncased-finetuned-sst-2-english", device=-1, truncation=True, max_length=256)
        t = time.time()
        res = clf(texts, batch_size=64)
        tt = time.time() - t
        pt = np.array([1 if r["label"] == "POSITIVE" else 0 for r in res])
        out["distilbert_sst2"] = {"accuracy": round(accuracy_score(y, pt), 4), "macro_f1": round(f1_score(y, pt, average="macro"), 4),
                                  "texts_per_second": round(len(texts) / tt), "model_download_mb": 268}
    except Exception as e:  # keep the report honest if the model cannot be loaded
        out["distilbert_sst2"] = {"status": f"not evaluated: {type(e).__name__}: {e}"}

    # The blended score used in the product (VADER + 30% rating) is NOT evaluated against ratings: that would leak the label.
    out["decision"] = ("VADER is used in the pipeline: see accuracy/throughput trade-off above. The product blends VADER with "
                       "the star rating as a weak signal when a rating exists, so the blend is not scored against ratings.")
    (config.REPORTS_DIR / "sentiment_evaluation.json").write_text(json.dumps(out, indent=2))
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
