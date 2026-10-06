"""Automatic faithfulness checks for generated summaries (the hallucination-rate metric).

A summary is split into sentences. A sentence is *grounded* when
  1. it cites at least one complaint as [C<id>],
  2. every cited id belongs to the alert's evidence set, and
  3. every number it states (counts, years, dates) appears in the cited complaints or in the
     alert's structured facts.
A summary is hallucinated if any sentence is not grounded.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

CITE = re.compile(r"\[C(\d+)\]")
NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")
_SENT = re.compile(r"(?<=[.!?\]])\s+(?=[A-Z\[\"'])")
_CITE_ONLY = re.compile(r"^(\s*\[C\d+\])+\s*[.!?]?\s*$")


def _numbers(text: str) -> set[str]:
    text = CITE.sub(" ", text)
    return {n.replace(",", "").rstrip(".") for n in NUMBER.findall(text)}


@dataclass
class GroundingReport:
    sentences: int = 0
    ungrounded: list[str] = field(default_factory=list)
    issues: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.sentences > 0 and not self.ungrounded


def check_summary(summary: str, evidence: dict[int, str], facts: str) -> GroundingReport:
    rep = GroundingReport()
    fact_nums = _numbers(facts)
    sentences = [s.strip() for s in _SENT.split(summary.strip()) if s.strip()]
    for s in sentences:
        if _CITE_ONLY.match(s):  # stray citation fragment: attach to previous sentence's judgement
            continue
        rep.sentences += 1
        cites = [int(c) for c in CITE.findall(s)]
        if not cites:
            rep.ungrounded.append(s)
            rep.issues.append("no citation")
            continue
        bad = [c for c in cites if c not in evidence]
        if bad:
            rep.ungrounded.append(s)
            rep.issues.append(f"unknown citation(s) {bad}")
            continue
        allowed = set(fact_nums)
        for c in cites:
            allowed |= _numbers(evidence[c])
        stray = _numbers(s) - allowed
        if stray:
            rep.ungrounded.append(s)
            rep.issues.append(f"unsupported number(s) {sorted(stray)}")
    if rep.sentences == 0:
        rep.issues.append("empty summary")
    return rep
