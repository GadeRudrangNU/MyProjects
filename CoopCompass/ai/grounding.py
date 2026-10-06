"""Checks applied to LLM output"""
from __future__ import annotations

import re

from backend.app.services.skills import extract_skills

_NUM = re.compile(r"\d+(?:[.,]\d+)?%?")


def numbers_in(text: str) -> set[str]:
    return {n.rstrip(".,") for n in _NUM.findall(text)}


def check_rewrite(source: str, rewrite: str) -> tuple[bool, str]:
    if not rewrite or not rewrite.strip():
        return False, "empty rewrite"
    added_skills = [s for s in extract_skills(rewrite) if s not in set(extract_skills(source))]
    if added_skills:
        return False, "introduced technologies not in the source bullet: " + ", ".join(added_skills)
    added_nums = numbers_in(rewrite) - numbers_in(source)
    if added_nums:
        return False, "introduced numbers not in the source bullet: " + ", ".join(sorted(added_nums))
    if len(rewrite.split()) > 60:
        return False, "rewrite is too long to be a resume bullet"
    return True, ""


def unsupported_skills(text: str, allowed_skills: set[str], job_skills: set[str]) -> list[str]:
    out = []
    for s in extract_skills(text):
        if s in allowed_skills:
            continue
        out.append(s)
    return out
