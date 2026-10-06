"""Draw a random sample of feedback for HUMAN labeling.

Usage:  python scripts/create_labeling_sample.py [--n 150] [--seed 7] [--force]

Writes data/evaluation/labeling_sample.csv with columns:
    feedback_id, text, predicted_theme, predicted_theme_id, theme_keywords, human_theme, correct_cluster
The last two columns are intentionally empty -- a person fills them in (see data/evaluation/README.md).
A simple random sample (not stratified by theme) is used so precision is an unbiased estimate of
assignment quality across the whole corpus. Existing labeled files are never overwritten without --force.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd
from sqlalchemy import text

from backend.app import db
from ml import config

OUT = config.DATA_DIR / "evaluation" / "labeling_sample.csv"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=150)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    if OUT.exists() and not a.force:
        sys.exit(f"{OUT} already exists (it may contain your labels). Use --force to overwrite.")
    engine = db.get_engine()
    with engine.connect() as c:
        df = pd.read_sql(text(
            "SELECT f.id AS feedback_id, f.text, t.id AS predicted_theme_id, "
            "COALESCE(t.pm_label, t.generated_label) AS predicted_theme, t.keywords "
            "FROM feedback f JOIN feedback_theme_mapping m ON m.feedback_id=f.id JOIN themes t ON t.id=m.theme_id "
            "WHERE f.synthetic = false AND t.kind <> 'uncategorized'"), c)
    s = df.sample(min(a.n, len(df)), random_state=a.seed).copy()
    s["theme_keywords"] = s.keywords.map(lambda k: ", ".join((k or [])[:6]))
    s["human_theme"] = ""
    s["correct_cluster"] = ""
    OUT.parent.mkdir(parents=True, exist_ok=True)
    s[["feedback_id", "text", "predicted_theme", "predicted_theme_id", "theme_keywords", "human_theme", "correct_cluster"]] \
        .to_csv(OUT, index=False, encoding="utf-8")
    print(f"Wrote {len(s)} rows to {OUT}. Fill in `correct_cluster` (1/0) and `human_theme`, then run scripts/evaluate_labels.py")


if __name__ == "__main__":
    main()
