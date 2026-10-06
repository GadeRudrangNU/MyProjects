"""Application analytics computed from stored data"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from statistics import mean

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import AnalyticsEvent, Application, ApplicationEvent, Job, TimeRecord, utcnow

INSUFFICIENT = "Not enough application history yet."
APPLIED_OR_LATER = {"Applied", "Assessment", "Interview", "Offer"}
INTERVIEW_OR_LATER = {"Interview", "Offer"}
OUTCOME_STATUSES = {"Assessment", "Interview", "Offer", "Rejected"}
FUNNEL = [("job_added", "Job Added"), ("job_analyzed", "Analyzed"), ("job_saved", "Saved"),
          ("application_started", "Application Started"), ("application_marked_applied", "Applied"),
          ("interview_received", "Interview")]

ROLE_FAMILIES = [
    ("Product Management", r"product (manager|management|owner|analyst|operations)|\bapm\b|\bpm\b"),
    ("ML / AI", r"machine learning|\bml\b|\bai\b|data scien|nlp|deep learning|research scientist"),
    ("Data / Analytics", r"data|analytics|analyst|business intelligence|\bbi\b"),
    ("Software Engineering", r"software|developer|engineer|backend|frontend|full[- ]?stack|sde|swe|devops"),
    ("Business / Operations", r"business|operations|consult|strategy|project|program|marketing|finance"),
]


def role_family(title: str) -> str:
    t = title.lower()
    for name, pat in ROLE_FAMILIES:
        if re.search(pat, t):
            return name
    return "Other"


def _rate(num: int, den: int, enough: bool = True) -> dict:
    return {"numerator": num, "denominator": den, "rate": round(num / den, 3) if den and enough else None}


def _week_start(d: datetime) -> datetime:
    d0 = d.replace(hour=0, minute=0, second=0, microsecond=0)
    return d0 - timedelta(days=d0.weekday())


def assisted_minutes_by_job(session: Session) -> dict[int, float]:
    out: dict[int, float] = defaultdict(float)
    for t in session.scalars(select(TimeRecord)):
        if t.job_id is not None:
            out[t.job_id] += t.seconds / 60.0
    return out


def history_by_app(session: Session) -> dict[int, set[str]]:
    h: dict[int, set[str]] = defaultdict(set)
    for e in session.scalars(select(ApplicationEvent)):
        h[e.application_id].add(e.to_status)
    return h


def compute_funnel(session: Session) -> list[dict]:
    jobs_by_event: dict[str, set[int]] = defaultdict(set)
    for ev in session.scalars(select(AnalyticsEvent).where(AnalyticsEvent.job_id.is_not(None))):
        jobs_by_event[ev.name].add(ev.job_id)
    out, later = [], set()
    for name, label in reversed(FUNNEL):
        later = later | jobs_by_event.get(name, set())
        out.append({"stage": name, "label": label, "count": len(later)})
    return list(reversed(out))


def compute_analytics(session: Session, scores: dict[int, float | None], matches: dict[int, dict],
                      now: datetime | None = None) -> dict:
    now = now or utcnow()
    jobs = {j.id: j for j in session.scalars(select(Job))}
    apps = list(session.scalars(select(Application)))
    hist = history_by_app(session)
    ev_all = list(session.scalars(select(AnalyticsEvent)))
    assisted = assisted_minutes_by_job(session)

    applied = [a for a in apps if hist[a.id] & APPLIED_OR_LATER]
    reached_interview = [a for a in apps if hist[a.id] & INTERVIEW_OR_LATER]
    reached_offer = [a for a in apps if "Offer" in hist[a.id]]
    reached_assess = [a for a in apps if "Assessment" in hist[a.id]]
    min_n = settings.min_applications_for_rates
    sufficient = len(applied) >= min_n

    live = [(jid, s) for jid, s in scores.items() if s is not None and jid in jobs and jobs[jid].user_state != "ignored"]
    analyzed_ids = {e.job_id for e in ev_all if e.name == "job_analyzed" and e.job_id}
    app_scores = [a.match_score for a in apps if a.match_score is not None]

    dl = []
    app_by_job = {a.job_id: a for a in apps}
    for jid, j in jobs.items():
        a = app_by_job.get(jid)
        if j.user_state == "ignored" or (a and a.status in APPLIED_OR_LATER | {"Rejected", "Withdrawn"}):
            continue
        d = (a.deadline if a and a.deadline else None) or j.application_deadline
        if d and d >= now - timedelta(hours=12):
            dl.append({"job_id": jid, "application_id": a.id if a else None, "company": j.company, "title": j.title,
                       "deadline": d.isoformat(), "days_left": max(0, (d - now).days), "status": a.status if a else None})
    dl.sort(key=lambda x: x["deadline"])

    this_week = _week_start(now)
    weeks = [this_week - timedelta(weeks=i) for i in range(7, -1, -1)]
    wk = {w: {"week_start": w.date().isoformat(), "applications_started": 0, "applications_submitted": 0, "jobs_analyzed": 0}
          for w in weeks}
    key = {"application_started": "applications_started", "application_marked_applied": "applications_submitted",
           "job_analyzed": "jobs_analyzed"}
    for e in ev_all:
        if e.name in key and _week_start(e.created_at) in wk:
            wk[_week_start(e.created_at)][key[e.name]] += 1

    thr = settings.high_match_threshold
    hi = [a for a in applied if a.match_score is not None and a.match_score >= thr]
    lo = [a for a in applied if a.match_score is not None and a.match_score < thr]

    def fit(group):
        n_int = sum(1 for a in group if a in reached_interview)
        return {"applications": len(group), "interviews": n_int, "rate": round(n_int / len(group), 3) if group and sufficient else None}

    roles: dict[str, dict] = {}
    for a in applied:
        fam = role_family(jobs[a.job_id].title) if a.job_id in jobs else "Other"
        r = roles.setdefault(fam, {"role": fam, "applications": 0, "interviews": 0, "offers": 0})
        r["applications"] += 1
        r["interviews"] += a in reached_interview
        r["offers"] += a in reached_offer

    bands = [("0-49", 0, 50), ("50-69", 50, 70), ("70-84", 70, 85), ("85-100", 85, 101)]
    score_bands = []
    for name, lo_b, hi_b in bands:
        g = [a for a in applied if a.match_score is not None and lo_b <= a.match_score < hi_b]
        score_bands.append({"band": name, "applications": len(g), "interviews": sum(1 for a in g if a in reached_interview)})

    versions: dict[str, dict] = {}
    for a in applied:
        v = a.resume_version or "(unspecified)"
        r = versions.setdefault(v, {"version": v, "applications": 0, "interviews": 0})
        r["applications"] += 1
        r["interviews"] += a in reached_interview

    gap_counter: Counter = Counter()
    n_matched = 0
    for jid, m in matches.items():
        if jid in jobs and jobs[jid].user_state != "ignored":
            n_matched += 1
            for g in m.get("gaps", []):
                if g["kind"] == "skill_required":
                    gap_counter[g["requirement"]] += 1
    gap_freq = [{"skill": s, "count": c, "share": round(c / n_matched, 3)} for s, c in gap_counter.most_common(12)]

    times = [assisted[a.job_id] for a in applied if assisted.get(a.job_id, 0) > 0]
    avg_time = round(mean(times), 1) if times else None

    outcomes = sum(1 for a in apps if hist[a.id] & OUTCOME_STATUSES)
    if outcomes < 10:
        stage, msg = "collecting", (f"{outcomes} application outcome(s) recorded. Too few to learn anything reliable; "
                                    "this view stays descriptive. Personalised re-ranking needs roughly 30+ outcomes.")
    elif outcomes < 30:
        stage, msg = "descriptive", (f"{outcomes} outcomes recorded. Patterns below are descriptive only; "
                                     "sample sizes are still too small for a learned ranking model.")
    else:
        stage, msg = "calibration_possible", (f"{outcomes} outcomes recorded. Enough to start checking whether match-score "
                                              "bands predict interviews and to calibrate dimension weights (still validate carefully).")

    insights: list[str] = []
    if gap_freq and n_matched >= 3:
        g = gap_freq[0]
        insights.append(f"Most frequent required-skill gap across {n_matched} analyzed jobs: {g['skill']} ({g['count']} of {n_matched}).")
    if sufficient:
        if hi and lo:
            insights.append(f"Interviews from high-fit (≥{thr:.0f}) applications: {fit(hi)['interviews']}/{len(hi)}; "
                            f"from lower-fit: {fit(lo)['interviews']}/{len(lo)}. Small samples; not statistically meaningful.")
        if roles:
            best = max(roles.values(), key=lambda r: (r["interviews"] / r["applications"], r["applications"]))
            insights.append(f"Role family with the highest interview share so far: {best['role']} "
                            f"({best['interviews']}/{best['applications']} applications).")

    return {
        "summary": {
            "jobs_total": len(jobs),
            "jobs_analyzed": len(analyzed_ids),
            "high_match_jobs": sum(1 for _, s in live if s >= thr),
            "applications_in_progress": sum(1 for a in apps if a.status in {"Preparing", "Assessment", "Interview"}),
            "applications_submitted": len(applied),
            "interviews": len(reached_interview),
            "offers": len(reached_offer),
            "avg_match_score": round(mean(s for _, s in live), 1) if live else None,
            "upcoming_deadlines": dl[:8],
        },
        "weekly_activity": list(wk.values()),
        "funnel": compute_funnel(session),
        "sufficient_data": sufficient,
        "min_applications_for_rates": min_n,
        "insufficient_message": INSUFFICIENT,
        "conversion": {
            "applied": len(applied),
            "assessment_rate": _rate(len(reached_assess), len(applied), sufficient),
            "interview_rate": _rate(len(reached_interview), len(applied), sufficient),
            "interview_to_offer_rate": _rate(len(reached_offer), len(reached_interview), sufficient),
        },
        "avg_time_per_application_minutes": avg_time,
        "avg_match_score_of_applications": round(mean(app_scores), 1) if app_scores else None,
        "fit_conversion": {"threshold": thr, "high_fit": fit(hi), "low_fit": fit(lo)},
        "role_performance": sorted(roles.values(), key=lambda r: -r["applications"]),
        "score_bands": score_bands,
        "resume_version_performance": sorted(versions.values(), key=lambda r: -r["applications"]),
        "skill_gap_frequency": gap_freq,
        "insights": insights,
        "learning": {"stage": stage, "outcomes_recorded": outcomes, "message": msg},
    }
