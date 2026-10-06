import importlib.util
from pathlib import Path

import pandas as pd
import pytest

spec = importlib.util.spec_from_file_location("evaluate_labels", Path(__file__).resolve().parent.parent / "scripts" / "evaluate_labels.py")
ev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ev)


def test_no_labels_means_pending_not_a_number(tmp_path):
    assert ev.human_block(tmp_path / "missing.csv")["status"] == "pending"
    p = tmp_path / "empty.csv"
    pd.DataFrame({"feedback_id": ["a"], "text": ["x"], "predicted_theme": ["t"], "human_theme": [""], "correct_cluster": [""]}).to_csv(p, index=False)
    out = ev.human_block(p)
    assert out["status"] == "pending" and "precision" not in out and out["n_labeled"] == 0


def test_precision_and_agreement_from_labels(tmp_path):
    rows = []
    for i in range(30):                      # 30 labeled: 24 correct -> 0.8
        rows.append({"feedback_id": str(i), "text": "t", "predicted_theme": "A" if i < 15 else "B",
                     "human_theme": "alpha" if i < 15 else "beta", "correct_cluster": "1" if i % 5 else "0"})
    rows.append({"feedback_id": "x", "text": "t", "predicted_theme": "A", "human_theme": "", "correct_cluster": ""})  # unlabeled ignored
    p = tmp_path / "l.csv"
    pd.DataFrame(rows).to_csv(p, index=False)
    out = ev.human_block(p)
    assert out["status"] == "completed" and out["n_labeled"] == 30 and out["correct"] == 24
    assert out["precision"] == pytest.approx(0.8)
    lo, hi = out["precision_ci95"]
    assert lo < 0.8 < hi
    ag = out["clustering_agreement"]
    assert ag["adjusted_rand_index"] == pytest.approx(1.0) and ag["pairwise_f1"] == pytest.approx(1.0)
    assert "warning" in out                  # n < 100 -> indicative only


def test_wilson_interval_bounds():
    lo, hi = ev.wilson(0, 10)
    assert lo == pytest.approx(0, abs=1e-9) and hi < 0.4
