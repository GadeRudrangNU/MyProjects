"""Compute evaluation metrics from the human-labeled sample -- or report "pending" if no labels exist.

Usage:  python scripts/evaluate_labels.py [path/to/labeled.csv]
Writes: reports/evaluation_metrics.json

Nothing is ever estimated or filled in: with zero labeled rows the human-evaluation block says pending.
"""
from __future__ import annotations

import json
import math
import sys
from itertools import combinations
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd
from sklearn.metrics import adjusted_rand_score, completeness_score, homogeneity_score, normalized_mutual_info_score

from ml import config

DEFAULT = config.DATA_DIR / "evaluation" / "labeling_sample.csv"
OUT = config.REPORTS_DIR / "evaluation_metrics.json"


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((c - m) / d, (c + m) / d)


def pairwise_prf(pred: list[str], gold: list[str]) -> dict:
    """Pair-counting precision/recall/F1: is 'same theme' for a pair of rows agreed by model and human?"""
    tp = fp = fn = 0
    for i, j in combinations(range(len(pred)), 2):
        p, g = pred[i] == pred[j], gold[i] == gold[j]
        tp += p and g
        fp += p and not g
        fn += (not p) and g
    prec = tp / (tp + fp) if tp + fp else None
    rec = tp / (tp + fn) if tp + fn else None
    f1 = 2 * prec * rec / (prec + rec) if prec and rec else None
    return {"pairs_same_theme_by_model": tp + fp, "pairs_same_theme_by_human": tp + fn,
            "pairwise_precision": prec, "pairwise_recall": rec, "pairwise_f1": f1}


def human_block(path: Path) -> dict:
    if not path.exists():
        return {"status": "pending", "note": "Human evaluation pending.", "n_labeled": 0,
                "how_to": "python scripts/create_labeling_sample.py, label the CSV, then rerun this script"}
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    df["correct_cluster"] = df["correct_cluster"].str.strip()
    lab = df[df.correct_cluster.isin(["0", "1"])].copy()
    n = len(lab)
    if n == 0:
        return {"status": "pending", "note": "Human evaluation pending.", "n_labeled": 0, "sample_rows": len(df)}
    k = int((lab.correct_cluster == "1").sum())
    lo, hi = wilson(k, n)
    out = {"status": "completed", "n_labeled": n, "sample_rows": len(df), "correct": k,
           "precision": k / n, "precision_ci95": [round(lo, 4), round(hi, 4)],
           "definition": "precision = share of labeled feedback whose assigned theme a human judged correct"}
    ht = lab[lab.human_theme.str.strip() != ""]
    if len(ht) >= 20:
        pred, gold = ht.predicted_theme.tolist(), ht.human_theme.str.strip().str.lower().tolist()
        out["clustering_agreement"] = {
            "n_with_human_theme": len(ht), "n_human_themes": len(set(gold)),
            "adjusted_rand_index": round(float(adjusted_rand_score(gold, pred)), 4),
            "normalized_mutual_info": round(float(normalized_mutual_info_score(gold, pred)), 4),
            "homogeneity": round(float(homogeneity_score(gold, pred)), 4),
            "completeness": round(float(completeness_score(gold, pred)), 4),
            **pairwise_prf(pred, gold),
        }
        pf = out["clustering_agreement"]["pairwise_f1"]
        out["f1"] = pf
        out["recall"] = out["clustering_agreement"]["pairwise_recall"]
        out["agreement_caveat"] = ("pairwise recall/F1 depend on how coarse the human taxonomy is: a human grouping much broader than "
                                   "the model's themes lowers recall by construction. Lead with precision and homogeneity.")
    else:
        out["clustering_agreement"] = "not computed: needs >= 20 rows with a human_theme label"
    if n < 100:
        out["warning"] = "Fewer than 100 labeled rows: treat precision as indicative only."
    return out


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
    result: dict = {"human_evaluation": human_block(path)}
    for name, key in (("pipeline_metrics.json", "clustering_pipeline"), ("sentiment_evaluation.json", "sentiment_vs_star_rating"),
                      ("data_preparation.json", "data_preparation")):
        p = config.REPORTS_DIR / name
        if p.exists():
            result[key] = json.loads(p.read_text())
    config.REPORTS_DIR.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(result, indent=2))
    print(json.dumps(result["human_evaluation"], indent=2))


if __name__ == "__main__":
    main()
