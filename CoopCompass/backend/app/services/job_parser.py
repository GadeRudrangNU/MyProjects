"""Job description parser"""
from __future__ import annotations

import hashlib
import re
from collections import Counter
from datetime import datetime

from .skills import extract_skills

_REQ_HEAD = re.compile(
    r"^(?:minimum\s+|basic\s+|required\s+|key\s+)?(requirements?|qualifications?|what you(?:'ll)? need|what we(?:'re| are) looking for|"
    r"you have|must[- ]haves?|required (?:skills|qualifications)|who you are|skills required|about you)\s*:?\s*$",
    re.IGNORECASE)
_PREF_HEAD = re.compile(
    r"^(preferred(?: qualifications| skills)?|nice[- ]to[- ]haves?|bonus(?: points)?|plus(?:es)?|desired(?: skills)?|"
    r"it'?s a plus|good to have)\s*:?\s*$", re.IGNORECASE)
_RESP_HEAD = re.compile(
    r"^(responsibilities|what you(?:'ll| will) do|duties|the role|day[- ]to[- ]day|your impact|in this role.*|key responsibilities|"
    r"what you will be doing)\s*:?\s*$", re.IGNORECASE)
_OTHER_HEAD = re.compile(
    r"^(about (?:us|the (?:company|team|role))|benefits|perks|compensation|why join.*|our (?:team|mission|values)|equal opportunity.*|"
    r"how to apply|location|salary(?: range)?)\s*:?\s*$", re.IGNORECASE)
_BULLET = re.compile(r"^\s*(?:[•●▪\-\*–—·]|\d+[.)])\s+")
_WORKAUTH = re.compile(
    r"(sponsor|visa|work authori[sz]ation|authori[sz]ed to work|citizen|permanent resident|green card|security clearance|"
    r"eligib\w+ to work|OPT|CPT|H-?1B)", re.IGNORECASE)
_STOP = set("""a an and are as at be by for from has have in is it of on or that the to with you your our we will this these those
they their who what which when where within across experience work working team teams role position job candidate strong good great
new ability able including such etc must should can also plus years year skills knowledge understanding company business
opportunity opportunities join looking required preferred responsibilities qualifications requirements""".split())


def fingerprint(company: str, title: str, location: str | None, description: str) -> str:
    key = "|".join([company.strip().lower(), title.strip().lower(), (location or "").strip().lower(),
                    re.sub(r"\s+", " ", description.strip().lower())[:400]])
    return hashlib.sha256(key.encode()).hexdigest()


def _section_lines(text: str) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {"intro": []}
    cur = "intro"
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        clean = _BULLET.sub("", line).strip().rstrip(":").strip()
        is_heading = len(line) < 60 and not _BULLET.match(line)
        if is_heading and _REQ_HEAD.match(clean + ":"):
            cur = "required"
        elif is_heading and _PREF_HEAD.match(clean + ":"):
            cur = "preferred"
        elif is_heading and _RESP_HEAD.match(clean + ":"):
            cur = "responsibilities"
        elif is_heading and _OTHER_HEAD.match(clean + ":"):
            cur = "other"
        else:
            sections.setdefault(cur, []).append(clean if _BULLET.match(line) else line)
            continue
        sections.setdefault(cur, [])
    return sections


def parse_experience_years(text: str) -> float | None:
    found = []
    for m in re.finditer(r"(\d+(?:\.\d+)?)\s*(?:\+|plus)?\s*(?:-\s*\d+\s*)?years?(?:'|’)?\s*(?:of\s+)?(?:relevant\s+|professional\s+|hands[- ]on\s+|industry\s+|work\s+)?(?:experience|exp)?", text, re.IGNORECASE):
        ctx = text[max(0, m.start() - 60): m.end() + 60].lower()
        if "experience" in ctx or "exp" in ctx:
            n = float(m.group(1))
            if 0 < n <= 15:
                found.append(n)
    return min(found) if found else None


def parse_education_level(text: str) -> str | None:
    t = text.lower()
    levels = []
    if re.search(r"bachelor'?s?|b\.?s\.?c?|undergraduate|b\.?a|college degree", t):
        levels.append(1)
    if re.search(r"master'?s?|m\.?s\.?|mba|graduate degree|graduate student|pursuing a graduate|graduate program", t):
        levels.append(2)
    if re.search(r"ph\.?d|doctorate|doctoral", t):
        levels.append(3)
    return {1: "bachelor", 2: "master", 3: "phd"}[min(levels)] if levels else None


def parse_employment_type(title: str, text: str) -> str | None:
    blob = f"{title}\n{text[:600]}".lower()
    if re.search(r"co-?op\b", blob):
        return "co-op"
    if "intern" in blob:
        return "internship"
    if re.search(r"part[- ]time", blob):
        return "part-time"
    if re.search(r"\bcontract(or)?\b", blob):
        return "contract"
    if re.search(r"full[- ]time", blob):
        return "full-time"
    return None


def parse_salary(text: str) -> tuple[str | None, float | None, float | None]:
    m = re.search(r"\$\s?(\d{2,3}(?:,\d{3})+|\d{2,3}(?:\.\d+)?\s?[kK])\s*(?:-|–|to)\s*\$?\s?(\d{2,3}(?:,\d{3})+|\d{2,3}(?:\.\d+)?\s?[kK])?\s*(/\s*(?:hr|hour|yr|year))?", text)
    m2 = re.search(r"\$\s?(\d{2,3}(?:\.\d+)?)\s*(?:-|–|to)\s*\$?\s?(\d{2,3}(?:\.\d+)?)\s*(?:/|per)\s*(?:hr|hour)", text, re.IGNORECASE)

    def num(s: str | None) -> float | None:
        if not s:
            return None
        s = s.replace(",", "").replace(" ", "")
        return float(s[:-1]) * 1000 if s[-1] in "kK" else float(s)

    if m2:
        return m2.group(0).strip(), float(m2.group(1)), float(m2.group(2))
    if m:
        return m.group(0).strip(), num(m.group(1)), num(m.group(2))
    return None, None, None


def parse_deadline(text: str) -> datetime | None:
    m = re.search(r"(?:apply by|deadline|applications? (?:close|due)|closing date|due by)[:\s]*"
                  r"((?:[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})|(?:\d{4}-\d{2}-\d{2})|(?:\d{1,2}/\d{1,2}/\d{4}))",
                  text, re.IGNORECASE)
    if not m:
        return None
    s = re.sub(r"(st|nd|rd|th)\b", "", m.group(1)).replace(".", "")
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%B %d, %Y", "%B %d %Y", "%b %d, %Y", "%b %d %Y"):
        try:
            return datetime.strptime(s.strip(), fmt)
        except ValueError:
            continue
    return None


def parse_location(text: str) -> str | None:
    m = re.search(r"^\s*location\s*[:\-]\s*(.+)$", text, re.IGNORECASE | re.MULTILINE)
    return m.group(1).strip()[:120] if m else None


def is_remote(location: str | None, text: str) -> bool:
    blob = f"{location or ''}\n{text[:500]}".lower()
    return bool(re.search(r"\bremote\b|work from home|\bwfh\b", blob)) and "not remote" not in blob and "no remote" not in blob


def extract_keywords(text: str, skills: list[str], n: int = 12) -> list[str]:
    words = re.findall(r"[A-Za-z][A-Za-z+#.\-]{2,}", text.lower())
    counts = Counter(w.strip(".-") for w in words if w not in _STOP)
    skill_words = {w for s in skills for w in s.lower().split()}
    ranked = [w for w, _ in counts.most_common(60) if w not in skill_words and counts[w] >= 2]
    return (skills[:6] + ranked)[:n]


def parse_job(description: str, title: str = "", company: str = "", location: str | None = None,
              employment_type: str | None = None, deadline: datetime | None = None) -> dict:
    text = description.strip()
    notes: list[str] = []
    sec = _section_lines(text)
    raw_req = "\n".join(sec.get("required", []))
    sec = {k: [ln for ln in v if not re.search(r"\bdegree\b|pursuing", ln, re.IGNORECASE)] if k in {"required", "preferred"} else v
           for k, v in sec.items()}
    req_text = "\n".join(sec.get("required", []))
    pref_text = "\n".join(sec.get("preferred", []))
    resp = [r for r in sec.get("responsibilities", []) if len(r) > 15][:15]

    if req_text or pref_text:
        required = extract_skills(req_text)
        preferred = [s for s in extract_skills(pref_text) if s not in required]
        if not required:
            required = [s for s in extract_skills(text) if s not in preferred]
            notes.append("Requirements section had no recognised skills; all other mentioned skills are treated as required.")
    else:
        mentioned = extract_skills(text)
        required, preferred = mentioned, []
        if mentioned:
            notes.append("No 'Requirements' / 'Preferred' sections detected; every skill mentioned is treated as required. "
                         "Check this against the posting.")
    resp_only = [s for s in extract_skills("\n".join(sec.get("responsibilities", [])))
                 if s not in required and s not in preferred]
    if (req_text or pref_text) and resp_only:
        preferred += resp_only
        notes.append("Skills mentioned only under Responsibilities (" + ", ".join(resp_only) + ") are weighted as preferred.")
    if not resp:
        resp = [ln for ln in text.splitlines() if _BULLET.match(ln)][:8]
        resp = [_BULLET.sub("", r).strip() for r in resp]
        if resp:
            notes.append("No 'Responsibilities' section detected; bulleted lines were used instead.")

    wa = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n", text) if _WORKAUTH.search(s) and 8 < len(s) < 300]
    sal_text, sal_min, sal_max = parse_salary(text)
    loc = location or parse_location(text)
    edu = parse_education_level(raw_req or text)
    return {
        "title": title.strip(),
        "company": company.strip(),
        "location": loc,
        "employment_type": employment_type or parse_employment_type(title, text),
        "salary_text": sal_text,
        "salary_min": sal_min,
        "salary_max": sal_max,
        "required_skills": required,
        "preferred_skills": preferred,
        "minimum_experience_years": parse_experience_years(req_text or text),
        "education": edu,
        "responsibilities": resp,
        "keywords": extract_keywords(text, required + preferred),
        "work_authorization_notes": wa[:5],
        "application_deadline": deadline or parse_deadline(text),
        "is_remote": is_remote(loc, text),
        "parse_notes": notes,
    }
