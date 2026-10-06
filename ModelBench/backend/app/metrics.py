import math


def percentile(values: list[float], q: float) -> float:
    """Linear-interpolated percentile (q in 0..100)."""
    if not values:
        return 0.0
    ordered = sorted(values)
    pos = (len(ordered) - 1) * q / 100
    lo, hi = math.floor(pos), math.ceil(pos)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (pos - lo)


def classification_metrics(y_true: list[str], y_pred: list[str]) -> dict:
    labels = sorted(set(y_true) | set(y_pred))
    n = len(y_true)
    correct = sum(t == p for t, p in zip(y_true, y_pred))
    per_class = {}
    for lab in labels:
        tp = sum(t == lab and p == lab for t, p in zip(y_true, y_pred))
        fp = sum(t != lab and p == lab for t, p in zip(y_true, y_pred))
        fn = sum(t == lab and p != lab for t, p in zip(y_true, y_pred))
        prec = tp / (tp + fp) if tp + fp else 0.0
        rec = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
        per_class[lab] = {"precision": prec, "recall": rec, "f1": f1}
    k = len(labels) or 1
    return {
        "accuracy": correct / n if n else 0.0,
        "precision": sum(c["precision"] for c in per_class.values()) / k,
        "recall": sum(c["recall"] for c in per_class.values()) / k,
        "f1": sum(c["f1"] for c in per_class.values()) / k,
        "per_class": per_class,
        "confusion_matrix": {
            "labels": labels,
            "matrix": [[sum(t == a and p == b for t, p in zip(y_true, y_pred)) for b in labels] for a in labels],
        },
        "n_samples": n,
    }
