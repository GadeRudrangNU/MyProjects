"""Clustering candidates + intrinsic evaluation. The final method is chosen from evidence
(see scripts/evaluate_clustering.py -> reports/clustering_evaluation.json)."""
from __future__ import annotations

import numpy as np
from sklearn.cluster import DBSCAN, HDBSCAN, KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import adjusted_rand_score, davies_bouldin_score, silhouette_score

from ml import config
from ml.theming import ctfidf_keywords, distinct_keywords


def reduce_dims(X: np.ndarray, dims: int = config.PCA_DIMS, seed: int = config.RANDOM_SEED) -> np.ndarray:
    Z = PCA(n_components=dims, random_state=seed).fit_transform(X)
    return Z / np.clip(np.linalg.norm(Z, axis=1, keepdims=True), 1e-12, None)


def run_kmeans(X: np.ndarray, k: int, seed: int = config.RANDOM_SEED) -> np.ndarray:
    return KMeans(n_clusters=k, n_init=3, random_state=seed).fit_predict(X)


def run_hdbscan(Z: np.ndarray, min_cluster_size: int, min_samples: int | None = None, method: str = "leaf") -> np.ndarray:
    return HDBSCAN(min_cluster_size=min_cluster_size, min_samples=min_samples, cluster_selection_method=method).fit_predict(Z)


def run_dbscan(Z: np.ndarray, eps: float, min_samples: int = 10) -> np.ndarray:
    return DBSCAN(eps=eps, min_samples=min_samples).fit_predict(Z)


def centroids(X: np.ndarray, labels: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    ids = np.array(sorted(c for c in np.unique(labels) if c != -1))
    C = np.vstack([X[labels == c].mean(axis=0) for c in ids])
    C /= np.clip(np.linalg.norm(C, axis=1, keepdims=True), 1e-12, None)
    return ids, C


def assign_noise_to_nearest(X: np.ndarray, labels: np.ndarray, min_sim: float) -> np.ndarray:
    """Give noise points the nearest cluster when similarity >= min_sim, else keep -1 (Uncategorized)."""
    out = labels.copy()
    noise = np.where(labels == -1)[0]
    if len(noise) == 0 or len(set(labels.tolist())) <= 1:
        return out
    ids, C = centroids(X, labels)
    sims = X[noise] @ C.T
    best = sims.argmax(axis=1)
    ok = sims[np.arange(len(noise)), best] >= min_sim
    out[noise[ok]] = ids[best[ok]]
    return out


def evaluate(X: np.ndarray, Z: np.ndarray, labels: np.ndarray, texts: list[str], seed: int = config.RANDOM_SEED,
             sample: int = 8000) -> dict:
    """Intrinsic metrics. Silhouette/DB are computed on non-noise points only."""
    n = len(labels)
    mask = labels != -1
    n_clusters = len(set(labels[mask].tolist()))
    res: dict = {"n_clusters": n_clusters, "noise_pct": round(100 * (1 - float(mask.mean())), 2)}
    if n_clusters < 2:
        return {**res, "silhouette_cosine": None}
    rng = np.random.RandomState(seed)
    idx = np.where(mask)[0]
    if len(idx) > sample:
        idx = rng.choice(idx, sample, replace=False)
    if len(set(labels[idx].tolist())) >= 2:
        res["silhouette_cosine"] = round(float(silhouette_score(X[idx], labels[idx], metric="cosine")), 4)
    res["davies_bouldin"] = round(float(davies_bouldin_score(Z[mask], labels[mask])), 4)
    ids, C = centroids(X, labels)
    pos = {c: i for i, c in enumerate(ids)}
    mi = np.where(mask)[0]
    cohesion = float(np.mean(np.einsum("ij,ij->i", X[mi], C[[pos[l] for l in labels[mi]]])))
    res["mean_cosine_to_centroid"] = round(cohesion, 4)
    sizes = np.array([(labels == c).sum() for c in ids])
    res["largest_cluster_share_pct"] = round(100 * float(sizes.max()) / n, 2)
    res["median_cluster_size"] = int(np.median(sizes))
    kw = ctfidf_keywords(texts, labels, top_n=10)
    top = [t for c in kw for t in distinct_keywords(kw[c], 10)]
    res["topic_diversity"] = round(len(set(top)) / max(len(top), 1), 4)
    return res


def stability_ari(fit_fn, X: np.ndarray, frac: float = 0.8, seed: int = config.RANDOM_SEED) -> float:
    """Refit on a random subsample and compare to the full fit on the shared points (ARI)."""
    rng = np.random.RandomState(seed + 1)
    idx = np.sort(rng.choice(len(X), int(frac * len(X)), replace=False))
    full = fit_fn(X)
    sub = fit_fn(X[idx])
    return round(float(adjusted_rand_score(full[idx], sub)), 4)
