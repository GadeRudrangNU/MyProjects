"""Deterministic job matching"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime

from . import embeddings
from .skills import canonicalize, extract_skills, related, family

DEFAULT_WEIGHTS = {"skills": 35.0, "experience": 20.0, "role": 15.0, "education": 10.0, "location": 10.0, "preferences": 10.0}
LABELS = {"skills": "Skills", "experience": "Experience", "role": "Role alignment", "education": "Education",
          "location": "Location", "preferences": "Preferences"}
EDU_ORDER = {None: 0, "bachelor": 1, "master": 2, "phd": 3}
SOURCE_BY_SECTION = {"Experience": "experience", "Projects": "project", "Skills": "skills_list",
                     "Education": "education", "Other": "other"}
CREDIT = {"demonstrated": 1.0, "listed": 0.3, "related": 0.35, "gap": 0.0}
NO_SPONSOR = re.compile(r"(not (?:able|willing|eligible) to (?:provide )?sponsor|no (?:visa )?sponsorship|will not sponsor|"
                        r"cannot sponsor|unable to sponsor|without (?:the need for )?(?:visa )?sponsorship|"
                        r"must be (?:a )?(?:u\.?s\.?|us) citizen|u\.?s\.? citizens? (?:only|required)|security clearance)", re.IGNORECASE)


def normalize_weights(w: dict | None) -> dict[str, float]:
    base = dict(DEFAULT_WEIGHTS)
    if w:
        for k in base:
            try:
                v = float(w.get(k, base[k]))
            except (TypeError, ValueError):
                v = base[k]
            base[k] = max(0.0, v)
    total = sum(base.values())
    if total <= 0:
        return dict(DEFAULT_WEIGHTS)
    return {k: round(v * 100.0 / total, 4) for k, v in base.items()}


def parse_weights_param(s: str | None) -> dict | None:
    if not s:
        return None
    out = {}
    for part in s.split(","):
        if ":" in part:
            k, v = part.split(":", 1)
            if k.strip() in DEFAULT_WEIGHTS:
                try:
                    out[k.strip()] = float(v)
                except ValueError:
                    pass
    return out or None


def profile_hash(profile: dict, weights: dict) -> str:
    keys = ["target_roles", "skills", "experience_months", "education", "preferred_locations", "remote_preference",
            "employment_types", "industries", "requires_sponsorship", "preferred_technologies", "salary_min",
            "headline"]
    payload = {k: profile.get(k) for k in keys}
    payload["evidence"] = [(e.get("section"), e.get("text"), sorted(e.get("skills", []))) for e in profile.get("evidence_items", [])]
    payload["weights"] = weights
    payload["backend"] = embeddings.backend_name()
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def build_evidence_index(profile: dict) -> dict[str, list[dict]]:
    index: dict[str, list[dict]] = {}
    for item in profile.get("evidence_items", []):
        section = item.get("section", "Other")
        source = SOURCE_BY_SECTION.get(section, "other")
        skills = {canonicalize(s) for s in item.get("skills", [])} | set(extract_skills(item.get("text", "")))
        for s in skills:
            index.setdefault(s, []).append({"id": item.get("id", ""), "section": section,
                                            "text": item.get("text", "")[:300], "source": source})
    for s in profile.get("skills", []):
        c = canonicalize(s)
        if c and c not in index:
            index[c] = [{"id": "profile-skill", "section": "Skills", "text": "Listed in your profile skills",
                         "source": "skills_list"}]
    rank = {"experience": 0, "project": 1, "other": 2, "skills_list": 3, "education": 4}
    for s in index:
        index[s].sort(key=lambda e: rank.get(e["source"], 9))
    return index


def classify_skill(skill: str, index: dict[str, list[dict]]) -> tuple[str, list[dict], str]:
    c = canonicalize(skill)
    refs = index.get(c, [])
    demo = [r for r in refs if r["source"] in {"experience", "project", "other"}]
    if demo:
        return "demonstrated", demo[:3], ""
    if refs:
        return "listed", refs[:1], "Listed in your skills but not shown in any experience or project bullet"
    rel = [s for s in index if related(c, s)]
    if rel:
        best = sorted(rel, key=lambda s: (index[s][0]["source"] not in {"experience", "project"}, s))[0]
        return "related", index[best][:2], f"Related, not the same: you have {best} ({family(c)})"
    return "gap", [], "No evidence found in current resume."


def classify_requirements(job: dict, index: dict[str, list[dict]]) -> list[dict]:
    out = []
    for kind, skills in (("required", job.get("required_skills", [])), ("preferred", job.get("preferred_skills", []))):
        for s in skills:
            level, ev, reason = classify_skill(s, index)
            out.append({"skill": s, "kind": kind, "level": level, "evidence": ev, "reason": reason})
    return out


def _skills_dim(reqs: list[dict]) -> tuple[float, str]:
    if not reqs:
        return 0.3, "No skills from the skill taxonomy were recognised in this posting, so this factor is a low placeholder (30%)."
    num = den = 0.0
    for r in reqs:
        w = 1.0 if r["kind"] == "required" else 0.5
        num += CREDIT[r["level"]] * w
        den += w
    n_dem = sum(1 for r in reqs if r["level"] == "demonstrated")
    return num / den, f"{n_dem} of {len(reqs)} listed skills are demonstrated in your resume evidence (preferred skills count half)."


def _experience_dim(job: dict, profile: dict) -> tuple[float, str]:
    have = float(profile.get("experience_months") or 0)
    need = job.get("minimum_experience_years")
    if not need:
        return 0.8, "The posting states no minimum experience, so this factor is mostly neutral (80%)."
    f = min(1.0, have / (need * 12))
    return f, f"Posting asks for {need:g}+ years; your profile shows {have / 12:.1f} years."


def _role_dim(job: dict, profile: dict) -> tuple[float, str]:
    roles = [r for r in profile.get("target_roles", []) if r.strip()]
    if not roles:
        return 0.5, "No target roles set in your profile, so this factor is neutral (50%)."
    title = job.get("title", "")
    title_tokens = set(embeddings._tokens(title))
    best, best_role = 0.0, roles[0]
    for r in roles:
        rt = set(embeddings._tokens(r))
        if rt and rt <= title_tokens:
            f = 1.0
        else:
            f = embeddings.to_fraction(embeddings.similarity(title, r))
        if f > best:
            best, best_role = f, r
    desc = title + ". " + " ".join(job.get("responsibilities", [])[:5])
    prof = " ".join(roles + [profile.get("headline", "")] + list(profile.get("skills", []))[:15])
    desc_f = embeddings.to_fraction(embeddings.similarity(desc, prof))
    f = 0.7 * best + 0.3 * desc_f
    return f, f"Title vs. closest target role '{best_role}': {best:.0%}; responsibilities vs. your profile: {desc_f:.0%}."


def _education_dim(job: dict, profile: dict) -> tuple[float, str]:
    need = job.get("education")
    have = 0
    for e in profile.get("education", []):
        d = (e.get("degree", "") + " " + e.get("field", "")).lower()
        lvl = 3 if re.search(r"ph\.?d|doctor", d) else 2 if re.search(r"master|m\.?s\b|m\.?eng|mba", d) else \
            1 if re.search(r"bachelor|b\.?s\b|b\.?a\b|b\.?tech|b\.?e\b", d) else 0
        have = max(have, lvl)
    if not need:
        return 1.0, "No degree requirement stated in the posting."
    n = EDU_ORDER.get(need, 0)
    if have >= n:
        return 1.0, f"Posting asks for a {need}'s-level degree; your profile lists an equal or higher degree."
    if have == n - 1 and have > 0:
        return 0.5, f"Posting asks for a {need}'s-level degree; your highest listed degree is one level below."
    return 0.0, f"Posting asks for a {need}'s-level degree; none listed in your profile."


def _loc_tokens(s: str) -> set[str]:
    return {t for t in re.findall(r"[a-z]+", s.lower()) if t not in {"usa", "us", "united", "states", "area", "greater"}}


def _location_dim(job: dict, profile: dict) -> tuple[float, str]:
    pref = profile.get("remote_preference", "any")
    prefs = [p for p in profile.get("preferred_locations", []) if p.strip()]
    if job.get("is_remote"):
        if pref in ("any", "remote"):
            return 1.0, "Remote role, which fits your remote preference."
        return 0.7, f"Remote role; your profile prefers {pref}."
    loc = job.get("location")
    if not loc:
        return 0.5, "The posting gives no location, so this factor is neutral (50%)."
    if not prefs:
        return 0.6, "No preferred locations set in your profile (60%, neutral-ish)."
    jt = _loc_tokens(loc)
    for p in prefs:
        pt = _loc_tokens(p)
        if pt and (pt & jt):
            return 1.0, f"'{loc}' matches your preferred location '{p}'."
    if pref == "remote":
        return 0.2, f"On-site/hybrid role in '{loc}'; your profile prefers remote."
    return 0.3, f"'{loc}' is outside your preferred locations."


def _annualize(x: float | None) -> float | None:
    if x is None:
        return None
    return x * 2080 if x < 1000 else x


def _preferences_dim(job: dict, profile: dict) -> tuple[float, str, list[dict]]:
    parts: list[tuple[float, float, str]] = []
    concerns: list[dict] = []
    types = [t.lower() for t in profile.get("employment_types", [])]
    jt = (job.get("employment_type") or "").lower()
    if types:
        if jt:
            parts.append((0.4, 1.0 if jt in types else 0.0, "employment type " + ("matches" if jt in types else "differs")))
        else:
            parts.append((0.4, 0.5, "employment type unknown"))
    techs = [canonicalize(t) for t in profile.get("preferred_technologies", [])]
    if techs:
        jskills = {canonicalize(s) for s in job.get("required_skills", []) + job.get("preferred_skills", [])}
        hit = [t for t in techs if t in jskills]
        parts.append((0.3, len(hit) / len(techs), f"{len(hit)}/{len(techs)} preferred technologies appear"))
    inds = [i.lower() for i in profile.get("industries", []) if i.strip()]
    if inds:
        blob = (job.get("company", "") + " " + job.get("raw_description", "")[:1500]).lower()
        hit = any(i in blob for i in inds)
        parts.append((0.15, 1.0 if hit else 0.0, "industry " + ("mentioned" if hit else "not mentioned")))
    smin = profile.get("salary_min")
    jmax = _annualize(job.get("salary_max") or job.get("salary_min"))
    if smin and jmax:
        ok = jmax >= smin
        parts.append((0.15, 1.0 if ok else 0.3, "salary " + ("meets" if ok else "is below") + " your minimum"))
    if not parts:
        frac, detail = 0.6, "No preference fields set that apply to this posting (60%, neutral-ish)."
    else:
        tw = sum(p[0] for p in parts)
        frac = sum(p[0] * p[1] for p in parts) / tw
        detail = "; ".join(p[2] for p in parts) + "."
    notes = job.get("work_authorization_notes", [])
    if profile.get("requires_sponsorship") is True and any(NO_SPONSOR.search(n) for n in notes):
        frac *= 0.25
        detail += " Work-authorization conflict: the posting says it will not sponsor / requires citizenship or clearance (score reduced)."
        concerns.append({"type": "work_authorization",
                         "message": "The posting appears to exclude sponsorship or require citizenship/clearance. Read: " + notes[0][:200]})
    elif notes:
        concerns.append({"type": "work_authorization",
                         "message": "The posting mentions work authorization: " + notes[0][:200] + " (verify against your situation)."})
    return frac, detail, concerns


def compute_match(job: dict, profile: dict, weights: dict | None = None, now: datetime | None = None) -> dict:
    now = now or datetime.utcnow()
    w = normalize_weights(weights or profile.get("match_weights"))
    index = build_evidence_index(profile)
    reqs = classify_requirements(job, index)

    fr: dict[str, tuple[float, str]] = {
        "skills": _skills_dim(reqs),
        "experience": _experience_dim(job, profile),
        "role": _role_dim(job, profile),
        "education": _education_dim(job, profile),
        "location": _location_dim(job, profile),
    }
    pf, pd, concerns = _preferences_dim(job, profile)
    fr["preferences"] = (pf, pd)

    breakdown = []
    for key in ["skills", "experience", "role", "education", "location", "preferences"]:
        f, detail = fr[key]
        breakdown.append({"key": key, "label": LABELS[key], "weight": round(w[key], 1),
                          "points": round(f * w[key], 1), "fraction": round(f, 3), "detail": detail})
    overall = round(sum(b["points"] for b in breakdown), 1)

    strong = [{"skill": r["skill"], "kind": r["kind"], "evidence": r["evidence"]} for r in reqs if r["level"] == "demonstrated"]
    partial = [{"skill": r["skill"], "kind": r["kind"], "reason": r["reason"], "evidence": r["evidence"]}
               for r in reqs if r["level"] in {"listed", "related"}]
    gaps = [{"requirement": r["skill"], "kind": f"skill_{r['kind']}", "message": "No evidence found in current resume."}
            for r in reqs if r["level"] == "gap"]
    need = job.get("minimum_experience_years")
    if need and fr["experience"][0] < 1.0:
        gaps.append({"requirement": f"{need:g}+ years of experience", "kind": "experience", "message": fr["experience"][1]})
        concerns.append({"type": "experience", "message": fr["experience"][1]})
    if job.get("education") and fr["education"][0] < 1.0:
        gaps.append({"requirement": f"{job['education'].title()}'s-level degree", "kind": "education", "message": fr["education"][1]})
    if fr["location"][0] <= 0.3:
        concerns.append({"type": "location", "message": fr["location"][1]})
    dl = job.get("application_deadline")
    if dl:
        days = (dl - now).days
        if days < 0:
            concerns.append({"type": "deadline", "message": "The listed application deadline has passed."})
        elif days <= 7:
            concerns.append({"type": "deadline", "message": f"Deadline in {days} day(s)."})

    if not reqs:
        concerns.append({"type": "low_confidence", "message": "No known skills were parsed from this posting (the skill taxonomy "
                         "is tech/business-focused), so the Skills factor is a placeholder and this score is unreliable."})
    demonstrated = sum(1 for r in reqs if r["level"] == "demonstrated")
    has_evidence = any(e.get("section") in {"Experience", "Projects", "Other"} and e.get("text", "").strip()
                       for e in profile.get("evidence_items", []))
    low_evidence = not has_evidence or (bool(reqs) and demonstrated / len(reqs) < 0.34)
    if low_evidence:
        concerns.append({"type": "low_evidence", "message": "Few or none of this posting's skills are backed by experience or "
                         "project bullets in your profile. The score leans on stated preferences, so treat it as provisional "
                         "and add evidence from your resume."})
    evidence_index = {r["skill"]: r["evidence"] for r in reqs if r["evidence"]}
    return {
        "job_id": job.get("id"),
        "overall": overall,
        "weights": {k: round(v, 1) for k, v in w.items()},
        "breakdown": breakdown,
        "strong": strong,
        "partial": partial,
        "gaps": gaps,
        "concerns": concerns,
        "evidence_index": evidence_index,
        "low_evidence": low_evidence,
        "embedding_backend": embeddings.backend_name(),
        "computed_at": now.isoformat(),
    }


def summarize(match: dict) -> dict:
    return {"top_strengths": [s["skill"] for s in match["strong"]][:3], "low_evidence": match.get("low_evidence", False),
            "gap_count": sum(1 for g in match["gaps"] if g["kind"] == "skill_required")}


def gap_analysis(job: dict, profile: dict) -> dict:
    index = build_evidence_index(profile)
    reqs = classify_requirements(job, index)
    present = [{"requirement": r["skill"], "kind": r["kind"], "evidence": r["evidence"]} for r in reqs if r["level"] == "demonstrated"]
    weak = [{"requirement": r["skill"], "kind": r["kind"], "reason": r["reason"], "evidence": r["evidence"]}
            for r in reqs if r["level"] in {"listed", "related"}]
    gaps = [{"requirement": r["skill"], "kind": r["kind"], "message": "No evidence found in current resume."}
            for r in reqs if r["level"] == "gap"]
    m = compute_match(job, profile)
    for g in m["gaps"]:
        if g["kind"] in {"experience", "education"}:
            gaps.append({"requirement": g["requirement"], "kind": g["kind"], "message": "No evidence found in current resume."})

    evid = [e for e in profile.get("evidence_items", []) if e.get("section") in {"Experience", "Projects", "Other"} and e.get("text")]
    resp_out = []
    resps = job.get("responsibilities", [])
    if resps and evid:
        sims = embeddings.similarity_matrix(resps, [e["text"] for e in evid])
        weak_t, pres_t = embeddings.evidence_threshold()
        for i, r in enumerate(resps):
            j = int(sims[i].argmax())
            s = float(sims[i, j])
            status = "present" if s >= pres_t else "weak" if s >= weak_t else "gap"
            ev = evid[j]
            resp_out.append({"text": r, "status": status, "similarity": round(s, 3),
                             "best_evidence": None if status == "gap" else
                             {"id": ev["id"], "section": ev["section"], "text": ev["text"][:300],
                              "source": SOURCE_BY_SECTION.get(ev["section"], "other")}})
    else:
        resp_out = [{"text": r, "status": "gap", "similarity": 0.0, "best_evidence": None} for r in resps]
    return {"job_id": job.get("id"), "present": present, "weak": weak, "gaps": gaps, "responsibilities": resp_out}
