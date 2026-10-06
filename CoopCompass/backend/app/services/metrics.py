"""Product metrics (time saved, usage) and survey import"""
from __future__ import annotations

import csv
import io
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from statistics import median

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import ROOT, settings
from ..models import AnalyticsEvent, Application, Profile, ResearchResult, TimeRecord, utcnow
from .analytics import APPLIED_OR_LATER, INTERVIEW_OR_LATER, history_by_app

RESEARCH_CSV = ROOT / "data" / "research" / "survey_results.csv"
IN_PROGRESS_MSG = "User research collection in progress."


def _med(xs: list[float]) -> float | None:
    return round(float(median(xs)), 1) if xs else None


def compute_product_metrics(session: Session, now: datetime | None = None) -> dict:
    now = now or utcnow()
    profile = session.scalar(select(Profile))
    apps = list(session.scalars(select(Application)))
    hist = history_by_app(session)
    events = list(session.scalars(select(AnalyticsEvent)))
    times = list(session.scalars(select(TimeRecord)))

    by_job: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for t in times:
        if t.job_id is not None:
            by_job[t.job_id][t.kind] += t.seconds / 60.0

    eval_times = [v["job_analysis"] for v in by_job.values() if v.get("job_analysis", 0) > 0]
    app_job_ids = {a.job_id for a in apps}
    prep_times = [v.get("resume_tailoring", 0) + v.get("application_preparation", 0)
                  for jid, v in by_job.items() if jid in app_job_ids
                  and v.get("resume_tailoring", 0) + v.get("application_preparation", 0) > 0]

    pairs = []
    for a in apps:
        assisted = sum(by_job.get(a.job_id, {}).values())
        if a.baseline_minutes and a.baseline_minutes > 0 and assisted > 0:
            pairs.append((a.baseline_minutes, assisted))
    med_base = _med([b for b, _ in pairs])
    med_assisted = _med([s for _, s in pairs])
    med_saved = _med([b - s for b, s in pairs])
    reduction = _med([(b - s) / b * 100 for b, s in pairs])

    applied = [a for a in apps if hist[a.id] & APPLIED_OR_LATER]
    interviews = [a for a in apps if hist[a.id] & INTERVIEW_OR_LATER]
    weekly_saved = None
    if med_saved is not None and applied:
        first = min((a.date_applied or a.created_at) for a in applied)
        weeks = max(1.0, (now - first).days / 7.0)
        weekly_saved = round(med_saved * len(applied) / weeks, 1)

    generated = sum(int(e.properties.get("count", 0)) for e in events if e.name == "resume_suggestion_generated")
    accepted = sum(1 for e in events if e.name == "resume_suggestion_accepted")
    n_research = len(research_rows(session))
    thr = settings.time_claim_threshold

    notes = [
        "All values are computed from local data; null means not enough data to compute.",
        "Time saved compares the user's optional self-reported 'how long would this normally take' (baseline) with "
        "tracked active time in CoopCompass for the same application. It is self-reported, not a controlled measurement.",
        f"Time-saved results are only claimable once >= {thr} observations exist (currently {len(pairs)}).",
        "median_time_saved_minutes and median_time_reduction_pct are medians of the per-application differences / percentage reductions.",
    ]
    return {
        "generated_at": now.isoformat(),
        "real_users": 1 if profile and profile.data else 0,
        "research_participants": n_research,
        "jobs_analyzed": len({e.job_id for e in events if e.name == "job_analyzed" and e.job_id}),
        "applications_started": len(apps),
        "applications_completed": len(applied),
        "median_job_evaluation_time_minutes": _med(eval_times),
        "median_application_preparation_time_minutes": _med(prep_times),
        "median_baseline_minutes": med_base,
        "median_assisted_minutes": med_assisted,
        "median_time_saved_minutes": med_saved,
        "median_time_reduction_pct": reduction,
        "observations_with_baseline": len(pairs),
        "claim_threshold": thr,
        "claimable": len(pairs) >= thr,
        "resume_suggestion_acceptance_rate": round(accepted / generated, 3) if generated else None,
        "application_to_interview_rate": round(len(interviews) / len(applied), 3) if applied else None,
        "weekly_estimated_time_saved_minutes": weekly_saved,
        "notes": notes,
    }


_SPLIT_FIELDS = ("pain_points", "tools", "desired_features")


def _split(v: str) -> list[str]:
    return [p.strip() for p in (v or "").split(";") if p.strip()]


def _num(v: str | None) -> float | None:
    try:
        return float(str(v).strip())
    except (TypeError, ValueError):
        return None


def read_survey_csv(text: str) -> list[dict]:
    rows = []
    for i, r in enumerate(csv.DictReader(io.StringIO(text))):
        r = {(k or "").strip(): (v or "").strip() for k, v in r.items()}
        if not any(r.values()):
            continue
        r.setdefault("respondent_id", f"row{i + 1}")
        if not r["respondent_id"]:
            r["respondent_id"] = f"row{i + 1}"
        rows.append(r)
    return rows


def import_survey(session: Session, rows: list[dict]) -> int:
    n = 0
    for r in rows:
        if session.scalar(select(ResearchResult).where(ResearchResult.respondent_id == r["respondent_id"])):
            continue
        session.add(ResearchResult(respondent_id=r["respondent_id"], data=r))
        n += 1
    session.commit()
    return n


def compute_research_metrics(rows: list[dict]) -> dict:
    if not rows:
        return {"status": "collection_in_progress", "message": IN_PROGRESS_MSG, "respondent_count": 0,
                "median_weekly_search_hours": None, "mean_minutes_per_application": None,
                "top_pain_points": [], "most_used_tools": [], "feature_preferences": []}

    def top(field: str, n: int = 8) -> list[dict]:
        c = Counter(x for r in rows for x in _split(r.get(field, "")))
        return [{"item": k, "count": v} for k, v in c.most_common(n)]

    hours = [x for x in (_num(r.get("weekly_search_hours")) for r in rows) if x is not None]
    mins = [x for x in (_num(r.get("minutes_per_application")) for r in rows) if x is not None]
    return {
        "status": "ok",
        "message": f"Computed from {len(rows)} imported survey response(s).",
        "respondent_count": len(rows),
        "median_weekly_search_hours": _med(hours),
        "mean_minutes_per_application": round(sum(mins) / len(mins), 1) if mins else None,
        "top_pain_points": top("pain_points"),
        "most_used_tools": top("tools"),
        "feature_preferences": top("desired_features"),
    }


def load_research_rows(path: Path | None = None) -> list[dict]:
    p = path or RESEARCH_CSV
    if not p.exists():
        return []
    return read_survey_csv(p.read_text(encoding="utf-8"))


def research_rows(session: Session) -> list[dict]:
    rows = [r.data for r in session.scalars(select(ResearchResult))]
    return rows or load_research_rows()
