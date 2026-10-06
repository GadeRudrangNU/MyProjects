"""Step 3: cluster -> label themes -> load everything into PostgreSQL + pgvector.

Usage:  python scripts/run_pipeline.py            (after prepare_data.py)
Resets the database tables (PM overrides are NOT preserved by a full reseed).
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import pandas as pd

from backend.app import db
from backend.app.models import (Base, Feedback, FeedbackThemeMapping, IngestionRun, MetaKV, PriorityWeights, Theme)
from backend.app.services import vectors
from ml import clustering as cl, config, theming
from ml.embeddings import get_embedder

PROCESSED = config.DATA_DIR / "processed"


def cluster(X: np.ndarray, Z: np.ndarray) -> tuple[np.ndarray, dict]:
    if config.CLUSTER_METHOD == "kmeans":
        labels = cl.run_kmeans(X, config.KMEANS_K)
        info = {"method": "kmeans", "k": config.KMEANS_K}
    elif config.CLUSTER_METHOD == "hdbscan":
        raw = cl.run_hdbscan(Z, config.HDBSCAN_MIN_CLUSTER_SIZE)
        labels = cl.assign_noise_to_nearest(X, raw, config.ASSIGN_MIN_SIMILARITY)
        info = {"method": "hdbscan+noise_reassignment", "min_cluster_size": config.HDBSCAN_MIN_CLUSTER_SIZE,
                "raw_noise_pct": round(100 * float((raw == -1).mean()), 2),
                "min_cosine_for_reassignment": config.ASSIGN_MIN_SIMILARITY}
    else:
        raise ValueError(config.CLUSTER_METHOD)
    return labels, info


def main() -> None:
    t0 = time.time()
    df = pd.read_parquet(PROCESSED / "feedback.parquet")
    X = np.load(PROCESSED / "embeddings.npy")
    Z = cl.reduce_dims(X)
    labels, cluster_info = cluster(X, Z)
    texts = df.text.tolist()
    print("clustered:", cluster_info, flush=True)
    intrinsic = cl.evaluate(X, Z, labels, texts)

    kw = theming.ctfidf_keywords(texts, labels, top_n=12)
    ids, C = cl.centroids(X, labels)
    centroid_of = dict(zip(ids.tolist(), C))
    theme_rows, mapping = [], []
    sims = np.zeros(len(df), dtype=np.float32)
    for c in ids.tolist():
        members = np.where(labels == c)[0]
        keywords = theming.distinct_keywords(kw.get(c, []), 8)
        rep_idx = theming.representative_indices(X, members, texts, k=5)
        neg_share = float((df.sentiment_label.values[members] == "negative").mean())
        kind = "praise" if neg_share < 0.15 else "issue"
        theme_rows.append(Theme(id=int(c) + 1, generated_label=theming.make_label(keywords), keywords=keywords,
                                representative_ids=[df.feedback_id.iloc[i] for i in rep_idx],
                                centroid=[float(v) for v in centroid_of[c]], kind=kind))
        sims[members] = X[members] @ centroid_of[c]
    if (labels == -1).any():
        theme_rows.append(Theme(id=0, generated_label="Uncategorized", keywords=[], representative_ids=[], kind="uncategorized"))
    theme_ids = np.where(labels == -1, 0, labels + 1)

    engine = db.get_engine()
    emb = get_embedder()
    store = vectors.get_vector_store(emb)
    store.delete_collection()
    Base.metadata.drop_all(engine)
    db.init_schema(engine)
    store.create_collection()
    S = db.session_factory(engine)
    prep = json.loads((config.REPORTS_DIR / "data_preparation.json").read_text())
    with S() as s:
        run = IngestionRun(source="app_review", filename="sealuzh/app_reviews (Hugging Face)",
                           stats={**prep, "kind": "seeded_public_dataset"}, column_mapping={
                               "review": "text", "date": "created_at", "star": "rating", "package_name": "product_area"})
        s.add(run)
        s.flush()
        s.add_all(theme_rows)
        s.flush()
        fb = []
        for r in df.itertuples():
            fb.append(Feedback(
                id=r.feedback_id, source=r.source, created_at=r.created_at.to_pydatetime(), customer_segment=None,
                text=r.text, rating=None if pd.isna(r.rating) else float(r.rating), sentiment=float(r.sentiment),
                sentiment_label=r.sentiment_label, severity=r.severity, severity_score=float(r.severity_score),
                severity_signals=json.loads(r.severity_signals), product_area=r.product_area, synthetic=False,
                meta={"duplicate_count": int(r.duplicate_count)}, ingestion_run_id=run.id))
        s.add_all(fb)
        s.flush()
        s.add_all([FeedbackThemeMapping(feedback_id=f, theme_id=int(t), similarity=float(sm), assigned_by="model")
                   for f, t, sm in zip(df.feedback_id, theme_ids, sims)])
        s.add(PriorityWeights(name="default", **config.DEFAULT_WEIGHTS))
        s.add(MetaKV(key="clustering", value={**cluster_info, "intrinsic_metrics": intrinsic,
                                              "embedding_model": config.EMBEDDING_MODEL}))
        s.commit()
    print("loaded relational data; writing vectors to pgvector ...", flush=True)
    vectors.add_vectors(store, df.feedback_id.tolist(), texts, X,
                        [{"feedback_id": f, "product_area": p} for f, p in zip(df.feedback_id, df.product_area)])

    metrics = {"records": len(df), "themes": len(ids), "uncategorized": int((labels == -1).sum()),
               "cluster_info": cluster_info, "intrinsic": intrinsic, "seconds": round(time.time() - t0, 1)}
    (config.REPORTS_DIR / "pipeline_metrics.json").write_text(json.dumps(metrics, indent=2))
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
