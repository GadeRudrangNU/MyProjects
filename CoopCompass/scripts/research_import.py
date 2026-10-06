"""Import survey results from CSV"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main() -> None:
    from backend.app.db import get_session, init_db
    from backend.app.services import metrics

    path = Path(sys.argv[1]) if len(sys.argv) > 1 else metrics.RESEARCH_CSV
    init_db()
    s = get_session()
    rows = metrics.load_research_rows(path)
    if rows:
        print(f"Imported {metrics.import_survey(s, rows)} new response(s) from {path}")
    print(json.dumps(metrics.compute_research_metrics(metrics.research_rows(s)), indent=2))


if __name__ == "__main__":
    main()
