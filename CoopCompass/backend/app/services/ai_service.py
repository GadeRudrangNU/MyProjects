"""Resume-bullet tailoring and application drafts"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ai import grounding, prompts, provider
from ai.provider import AIUnavailable

from ..config import settings
from ..models import AIGeneration, utcnow
from .matching import build_evidence_index
from .skills import canonicalize, extract_skills

DISCLAIMER_AI = "AI GENERATED — REVIEW BEFORE USING"
DISCLAIMER_TEMPLATE = "TEMPLATE DRAFT — REVIEW AND EDIT BEFORE USING"


def requests_today(session: Session) -> int:
    start = datetime.combine(utcnow().date(), datetime.min.time())
    return session.scalar(select(func.count()).select_from(AIGeneration).where(
        AIGeneration.api_call.is_(True), AIGeneration.created_at >= start)) or 0


def ai_available(session: Session | None = None) -> bool:
    if not provider.gemini_configured():
        return False
    return session is None or requests_today(session) < settings.ai_daily_limit


def _hash(*parts: str) -> str:
    return hashlib.sha256("\x1f".join(parts).encode()).hexdigest()


def _cached(session: Session, kind: str, prompt_hash: str) -> AIGeneration | None:
    return session.scalars(select(AIGeneration).where(
        AIGeneration.kind == kind, AIGeneration.prompt_hash == prompt_hash,
        AIGeneration.provider == "gemini").order_by(AIGeneration.id.desc())).first()


def _candidate_bullets(job: dict, profile: dict, limit: int = 4) -> list[dict]:
    jd_skills = [canonicalize(s) for s in job.get("required_skills", []) + job.get("preferred_skills", [])]
    out = []
    for e in profile.get("evidence_items", []):
        if e.get("section") not in {"Experience", "Projects"} or not e.get("text"):
            continue
        have = {canonicalize(s) for s in e.get("skills", [])} | set(extract_skills(e["text"]))
        hits = [s for s in jd_skills if s in have]
        if hits:
            out.append({"id": e["id"], "text": e["text"], "section": e["section"], "jd_terms": hits,
                        "score": sum(2 if s in job.get("required_skills", []) else 1 for s in hits)})
    out.sort(key=lambda b: -b["score"])
    return out[:limit]


def tailor(session: Session, job: dict, profile: dict, force: bool = False) -> dict:
    bullets = _candidate_bullets(job, profile)
    if not bullets:
        return {"provider": "local", "cached": False, "suggestions": [],
                "notice": "No experience or project bullet in your profile mentions skills this posting asks for, "
                          "so there is nothing honest to tailor. See the gaps listed in Resume Lab."}

    def base(b: dict) -> dict:
        return {"original": b["text"], "suggested": None, "jd_terms": b["jd_terms"],
                "source_evidence": {"id": b["id"], "section": b["section"], "text": b["text"]},
                "status": "pending"}

    local = []
    for b in bullets:
        s = base(b)
        s["rationale"] = ("Lead with this bullet: it already shows " + ", ".join(b["jd_terms"][:4]) +
                          ", which this posting asks for. Consider moving it higher in the section.")
        local.append(s)
    local_result = {"provider": "local", "cached": False, "suggestions": local,
                    "notice": "Local mode: showing which of your existing bullets best support this posting. "
                              "Enable Gemini (AI_PROVIDER=gemini + GEMINI_API_KEY) for suggested rewrites."}

    if not provider.gemini_configured():
        return local_result
    prompt = prompts.tailor_prompt(job, bullets)
    ph = _hash(prompts.PROMPT_VERSION, "tailor", prompt)
    hit = None if force else _cached(session, "tailor_raw", ph)
    if hit:
        raw, was_cached = hit.payload["raw"], True
    else:
        if requests_today(session) >= settings.ai_daily_limit:
            local_result["notice"] = (f"Daily AI request limit ({settings.ai_daily_limit}) reached; showing local guidance. "
                                      "Cached results still work.")
            return local_result
        try:
            raw, was_cached = provider.generate(prompt, json_mode=True), False
        except AIUnavailable as exc:
            local_result["notice"] = f"Gemini unavailable ({exc}); showing local guidance instead."
            return local_result
        session.add(AIGeneration(job_id=job.get("id"), kind="tailor_raw", provider="gemini", prompt_hash=ph,
                                 payload={"raw": raw}, api_call=True))
        session.commit()

    try:
        data = json.loads(raw)
        by_id = {d["id"]: d.get("rewrite", "") for d in data if isinstance(d, dict) and "id" in d}
    except (ValueError, TypeError):
        local_result["notice"] = "Gemini returned an unreadable response; showing local guidance instead."
        return local_result

    suggestions, rejected = [], 0
    for b in bullets:
        s = base(b)
        rewrite = by_id.get(b["id"], "")
        ok, why = grounding.check_rewrite(b["text"], rewrite)
        if ok:
            s["suggested"] = rewrite.strip()
            s["rationale"] = "Rewritten by Gemini using only the facts in your original bullet; checked automatically for added technologies/numbers."
        else:
            rejected += 1
            s["rationale"] = (f"Gemini's rewrite was discarded by the grounding check ({why}). "
                              "Your original bullet already supports: " + ", ".join(b["jd_terms"][:4]) + ".")
        suggestions.append(s)
    notice = "Suggestions generated by Gemini from your own bullets. Review each one; nothing is applied until you accept it."
    if rejected:
        notice += f" {rejected} rewrite(s) were discarded because they added information not in your resume."
    return {"provider": "gemini", "cached": was_cached, "suggestions": suggestions, "notice": notice}


def _facts(job: dict, profile: dict, match: dict) -> list[str]:
    facts: list[str] = []
    seen = set()
    for s in match["strong"]:
        for ev in s["evidence"]:
            if ev["source"] in {"experience", "project"} and ev["text"] not in seen:
                seen.add(ev["text"])
                facts.append(ev["text"])
    for e in profile.get("education", []):
        t = " ".join(x for x in [e.get("degree"), e.get("field"), "at", e.get("school")] if x)
        if t.strip() != "at":
            facts.append(("Studying: " if e.get("status") == "in_progress" else "Education: ") + t)
    if profile.get("headline"):
        facts.append("Headline: " + profile["headline"])
    return facts[:10]


def _local_draft(kind: str, job: dict, profile: dict, match: dict, question: str | None, facts: list[str]) -> str:
    skills = [s["skill"] for s in match["strong"]][:4]
    bullets = [f for f in facts if not f.startswith(("Studying", "Education", "Headline"))][:2]
    role, comp = job["title"], job["company"]
    skill_txt = ", ".join(skills) if skills else "[skills relevant to this role]"
    ev = "\n".join(f"- {b}" for b in bullets) or "- [Add a specific example from your experience]"
    if kind == "cover_letter":
        return (f"Dear Hiring Team at {comp},\n\nI am writing to apply for the {role} position. The role's focus on "
                f"{', '.join(job['required_skills'][:3]) or 'the listed responsibilities'} matches work I have done: {skill_txt}.\n\n"
                f"Relevant experience from my resume:\n{ev}\n\n[Add one sentence on why this company/team interests you.]\n\n"
                f"Thank you for your consideration.\n\n[Your Name]")
    if kind == "short_answer":
        return (f"Question: {question or '[paste the application question]'}\n\nDraft outline (edit into your own words):\n"
                f"{ev}\n- Tie it back to what {comp} needs for the {role} role: [one sentence]")
    if kind == "recruiter_outreach":
        return (f"Hi [Recruiter Name],\n\nI'm interested in the {role} role at {comp}. My background includes {skill_txt}"
                f"{' — for example: ' + bullets[0] if bullets else ''}. I'd welcome the chance to share more.\n\nThanks,\n[Your Name]")
    return (f"Hi [Name],\n\nI'm exploring the {role} opportunity at {comp} and noticed your work there. "
            f"I have experience with {skill_txt}. Would you be open to a 15-minute chat about the team?\n\nThanks,\n[Your Name]")


def draft(session: Session, job: dict, profile: dict, match: dict, kind: str, question: str | None, force: bool = False) -> dict:
    facts = _facts(job, profile, match)
    allowed = {canonicalize(s) for s in profile.get("skills", [])}
    for e in profile.get("evidence_items", []):
        allowed |= {canonicalize(s) for s in e.get("skills", [])} | set(extract_skills(e.get("text", "")))

    def local() -> dict:
        return {"provider": "local", "cached": False, "is_template": True, "facts_used": facts,
                "text": _local_draft(kind, job, profile, match, question, facts), "unsupported_skills": [],
                "disclaimer": DISCLAIMER_TEMPLATE}

    if not provider.gemini_configured():
        return local()
    prompt = prompts.draft_prompt(kind, job, facts, question)
    ph = _hash(prompts.PROMPT_VERSION, "draft", kind, prompt)
    hit = None if force else _cached(session, "draft_raw", ph)
    if hit:
        text, was_cached = hit.payload["raw"], True
    else:
        if requests_today(session) >= settings.ai_daily_limit:
            d = local()
            d["notice"] = "Daily AI request limit reached; showing a template instead."
            return d
        try:
            text, was_cached = provider.generate(prompt, temperature=0.5), False
        except AIUnavailable as exc:
            d = local()
            d["notice"] = f"Gemini unavailable ({exc}); showing a template instead."
            return d
        session.add(AIGeneration(job_id=job.get("id"), kind="draft_raw", provider="gemini", prompt_hash=ph,
                                 payload={"raw": text}, api_call=True))
        session.commit()
    flagged = grounding.unsupported_skills(text, allowed, set(job.get("required_skills", [])))
    return {"provider": "gemini", "cached": was_cached, "is_template": False, "facts_used": facts, "text": text,
            "unsupported_skills": flagged, "disclaimer": DISCLAIMER_AI}
