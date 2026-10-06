"""Load synthetic demo data into a separate database"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(ROOT / "data" / "demo.db"))
    args = ap.parse_args()
    db_path = Path(args.db).resolve()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"

    from backend.app.db import get_session, init_db
    from backend.app.services import resume_parser, store

    init_db()
    s = get_session()
    jobs = json.loads((ROOT / "data" / "jobs" / "demo_jobs.json").read_text(encoding="utf-8"))["jobs"]
    n = 0
    for j in jobs:
        days = j.get("deadline_days")
        _, created = store.create_job(
            s, company=j["company"], title=j["title"], description=j["description"], location=j.get("location"),
            deadline=datetime.utcnow() + timedelta(days=days) if days else None, source="demo_seed")
        n += created
    print(f"Jobs added: {n} (synthetic)")

    if not store.get_profile(s)["exists"]:
        draft = resume_parser.parse_resume((ROOT / "data" / "demo" / "demo_resume.txt").read_text(encoding="utf-8"))
        store.save_profile(s, {
            "name": "Alex Sample (demo)", "headline": "Data analytics graduate student seeking a co-op",
            "target_roles": ["Data Analyst", "Business Intelligence Analyst", "Product Analyst"],
            "skills": draft["skills"], "experience_months": draft["experience_months"], "education": draft["education"],
            "preferred_locations": ["Boston, MA"], "remote_preference": "any", "employment_types": ["co-op", "internship"],
            "industries": [], "work_authorization": "F-1 student (demo)", "requires_sponsorship": True,
            "preferred_technologies": ["Python", "SQL", "Tableau"], "salary_min": None,
            "evidence_items": draft["evidence_items"], "match_weights": {}, "resume_id": None,
        })
        print("Demo profile created from the fictional resume.")
    print(f"Database: {db_path}")


if __name__ == "__main__":
    main()
