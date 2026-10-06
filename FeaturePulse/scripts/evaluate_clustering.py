"""Step 2: compare clustering algorithms on the embedded corpus (intrinsic metrics + stability).

Usage:  python scripts/evaluate_clustering.py
Writes: reports/clustering_evaluation.json  (incrementally; finished candidates are skipped on re-run)

KMeans is evaluated on the full corpus. Density-based methods (DBSCAN/HDBSCAN) scale poorly, so they are evaluated on a fixed
random subsample (DENSITY_SAMPLE records, seed 42) -- stated explicitly in every result row.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import pandas as pd

from ml import clustering as cl, config

PROCESSED = config.DATA_DIR / "processed"
OUT = config.REPORTS_DIR / "clustering_evaluation.json"
DENSITY_SAMPLE = 20_000


def main() -> None:
    df = pd.read_parquet(PROCESSED / "feedback.parquet")
    X = np.load(PROCESSED / "embeddings.npy")
    texts = df.text.tolist()
    Z = cl.reduce_dims(X)
    rng = np.random.RandomState(config.RANDOM_SEED)
    sub = np.sort(rng.choice(len(X), DENSITY_SAMPLE, replace=False))
    Xs, Zs, ts = X[sub], Z[sub], [texts[i] for i in sub]
    print(f"{len(df):,} records, embedding dim {X.shape[1]}, PCA -> {Z.shape[1]}; density methods on {DENSITY_SAMPLE:,}-record subsample", flush=True)

    candidates = []
    for k in (20, 40, 60, 80, 120):
        candidates.append((f"kmeans_k{k}", "kmeans", {"k": k}, lambda A, k=k: cl.run_kmeans(A, k), "full"))
    for m in (30, 60, 120):
        candidates.append((f"hdbscan_leaf_mcs{m}", "hdbscan", {"min_cluster_size": m}, lambda A, m=m: cl.run_hdbscan(A, m), "sub"))
    for eps in (0.40, 0.50, 0.60):
        candidates.append((f"dbscan_eps{eps}", "dbscan", {"eps": eps, "min_samples": 10}, lambda A, e=eps: cl.run_dbscan(A, e, 10), "sub"))

    prior = {r["name"]: r for r in json.loads(OUT.read_text())["candidates"]} if OUT.exists() else {}
    results = dict(prior)
    # KMeans rows computed in the earlier (full-corpus) run are recorded in the output if present; else recomputed.
    for name, algo, params, fit, scope in candidates:
        if name in results:
            continue
        full = scope == "full"
        space, Xe, Ze, te = (X, X, Z, texts) if full else (Zs, Xs, Zs, ts)
        if algo == "kmeans":
            space = X
        t0 = time.time()
        labels = fit(space)
        row = {"name": name, "algorithm": algo, "params": params,
               "evaluated_on": len(Xe), **cl.evaluate(Xe, Ze, labels, te)}
        row["fit_seconds"] = round(time.time() - t0, 1)
        if algo == "hdbscan" and row["n_clusters"] >= 2:
            re = cl.assign_noise_to_nearest(Xe, labels, config.ASSIGN_MIN_SIMILARITY)
            row["after_noise_reassignment"] = cl.evaluate(Xe, Ze, re, te)
        if row["n_clusters"] >= 2:
            row["stability_ari_80pct_subsample"] = cl.stability_ari(fit, space)
        results[name] = row
        print(json.dumps(row), flush=True)
        OUT.write_text(json.dumps({"n_records": len(df), "density_sample": DENSITY_SAMPLE,
                                   "embedding_model": config.EMBEDDING_MODEL, "pca_dims": config.PCA_DIMS,
                                   "noise_reassignment_min_cosine": config.ASSIGN_MIN_SIMILARITY,
                                   "candidates": list(results.values())}, indent=2))


if __name__ == "__main__":
    main()
