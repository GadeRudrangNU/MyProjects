"""Step 1: raw public reviews -> cleaned, sampled, scored, embedded corpus (data/processed/).

Usage:  python scripts/prepare_data.py
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import pandas as pd

from ml import config, preprocessing as pp, sentiment, severity
from ml.embeddings import embed_with_cache

OUT = config.DATA_DIR / "processed"


def download_raw() -> None:
    if config.RAW_PARQUET.exists():
        return
    import requests

    url = "https://huggingface.co/datasets/sealuzh/app_reviews/resolve/main/data/train-00000-of-00001.parquet"
    config.RAW_PARQUET.parent.mkdir(parents=True, exist_ok=True)
    print("Downloading", url)
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    config.RAW_PARQUET.write_bytes(r.content)


def main() -> None:
    t0 = time.time()
    download_raw()
    raw = pd.read_parquet(config.RAW_PARQUET).rename(
        columns={"review": "text", "date": "created_at", "star": "rating", "package_name": "product_area"}
    )
    raw["created_at"] = pd.to_datetime(raw["created_at"], format="%B %d %Y", errors="coerce")

    cleaned, rep = pp.clean_dataframe(raw)
    df = pp.cap_per_group(cleaned, "product_area", config.SAMPLE_CAP_PER_APP)
    rep.kept_after_sampling = len(df)

    df["source"] = "app_review"
    df["customer_segment"] = None          # not present in this dataset -> stays null
    df["synthetic"] = False
    df["rating"] = df["rating"].astype(float)
    df["feedback_id"] = [
        pp.feedback_id(r.source, r.product_area, r.created_at.strftime("%Y-%m-%d"), r.text) for r in df.itertuples()
    ]
    df = df.drop_duplicates("feedback_id").reset_index(drop=True)

    df["sentiment"] = [sentiment.sentiment_score(t, r) for t, r in zip(df.text, df.rating)]
    df["sentiment_label"] = df["sentiment"].map(sentiment.sentiment_label)
    sev = [severity.severity_score(t, s, r) for t, s, r in zip(df.text, df.sentiment, df.rating)]
    df["severity_score"] = [s for s, _ in sev]
    df["severity_signals"] = [json.dumps(h) for _, h in sev]
    df["severity"] = df["severity_score"].map(severity.level_for)

    print(f"{len(df):,} records after cleaning+sampling; embedding with {config.EMBEDDING_MODEL} ...")
    emb = embed_with_cache(df.feedback_id.tolist(), df.text.tolist())
    assert emb.shape == (len(df), config.EMBEDDING_DIM)

    OUT.mkdir(parents=True, exist_ok=True)
    df.to_parquet(OUT / "feedback.parquet", index=False)
    np.save(OUT / "embeddings.npy", emb)
    stats = {
        **rep.as_dict(),
        "sample_cap_per_app": config.SAMPLE_CAP_PER_APP,
        "products": int(df.product_area.nunique()),
        "date_min": str(df.created_at.min().date()),
        "date_max": str(df.created_at.max().date()),
        "embedding_model": config.EMBEDDING_MODEL,
        "seconds": round(time.time() - t0, 1),
    }
    config.REPORTS_DIR.mkdir(exist_ok=True)
    (config.REPORTS_DIR / "data_preparation.json").write_text(json.dumps(stats, indent=2))
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
