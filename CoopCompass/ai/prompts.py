"""Prompt templates"""
from __future__ import annotations

import json

PROMPT_VERSION = "v1"

GROUNDING_RULES = """STRICT RULES:
- Use ONLY facts present in the CANDIDATE FACTS below. Never invent employers, projects, tools, technologies, metrics, numbers, dates or outcomes.
- If a job requirement has no supporting candidate fact, do NOT claim it. Do not imply experience the candidate does not have.
- Keep every number exactly as written in the facts, or omit it."""


def tailor_prompt(job: dict, bullets: list[dict]) -> str:
    payload = [{"id": b["id"], "bullet": b["text"], "jd_terms_already_in_bullet": b["jd_terms"]} for b in bullets]
    return f"""You help a student tailor resume bullets to a job posting.
{GROUNDING_RULES}
- Rewrite each bullet in at most 30 words, starting with a strong past-tense verb, keeping its meaning.
- You may re-order and re-word to emphasise job-relevant parts that are ALREADY in the bullet. Do not add new skills.

JOB: {job['title']} at {job['company']}
JOB REQUIRED SKILLS: {', '.join(job['required_skills'][:12])}
JOB RESPONSIBILITIES: {' | '.join(job['responsibilities'][:5])[:900]}

CANDIDATE BULLETS (JSON): {json.dumps(payload)}

Return JSON only: a list of objects {{"id": "<bullet id>", "rewrite": "<text>"}} — one per bullet."""


def draft_prompt(kind: str, job: dict, facts: list[str], question: str | None) -> str:
    task = {
        "cover_letter": "Write a concise cover letter (max 220 words, 3 short paragraphs). Use '[Your Name]' as the signature placeholder.",
        "short_answer": f"Write a concise answer (max 120 words) to this application question: {question or '(no question provided)'}",
        "recruiter_outreach": "Write a short message (max 90 words) to a recruiter expressing interest in this role. Use '[Recruiter Name]' and '[Your Name]'.",
        "networking": "Write a brief networking message (max 80 words) to an employee at this company asking for a short conversation. Use '[Name]' and '[Your Name]'.",
    }[kind]
    return f"""{task}
{GROUNDING_RULES}
- Tone: professional, specific, not exaggerated. No clichés like "passionate" or "perfect fit".
- Output the message text only.

JOB: {job['title']} at {job['company']}
JOB RESPONSIBILITIES: {' | '.join(job['responsibilities'][:5])[:900]}
JOB REQUIRED SKILLS: {', '.join(job['required_skills'][:12])}

CANDIDATE FACTS (the ONLY things you may claim):
""" + "\n".join(f"- {f}" for f in facts)
