"""Explainable, rule-based severity. Every point added is traceable to a named signal.

score = sum of triggered signal weights (capped at 1.0). The PM can override at theme level.
"""
from __future__ import annotations

import re

SIGNALS: list[tuple[str, float, re.Pattern]] = [
    ("crash_or_failure", 0.30, re.compile(r"\b(crash\w*|freez\w*|froze|hang\w*|force clos\w*|stopped working|stops working|not working|doesn'?t work|does not work|won'?t (open|start|load|work)|broken|bug\w*|error\w*|fail\w*|black screen|unresponsive)\b", re.I)),
    ("blocked_core_workflow", 0.25, re.compile(r"\b(can'?t|cannot|unable to|impossible|no way to|won'?t let|doesn'?t let|not able to|useless|unusable)\b", re.I)),
    ("security_payment_account", 0.30, re.compile(r"\b(login|log in|sign in|signin|password|account|payment|charged|charge|refund|billing|purchase|hack\w*|privacy|security|stolen|scam|malware|virus|data loss|lost (my )?data|deleted|permissions?)\b", re.I)),
    ("battery_or_performance", 0.15, re.compile(r"\b(battery|drain\w*|lag\w*|slow\w*|memory|overheat\w*|hot)\b", re.I)),
]
STRONG_NEGATIVE_SENTIMENT = ("strong_negative_sentiment", 0.20)
ONE_STAR = ("one_star_rating", 0.15)

LEVELS = [(0.75, "critical"), (0.5, "high"), (0.25, "medium"), (0.0, "low")]


def severity_signals(text: str, sentiment: float, rating: float | None = None) -> dict[str, float]:
    hits = {name: w for name, w, pat in SIGNALS if pat.search(text)}
    if sentiment <= -0.5:
        hits[STRONG_NEGATIVE_SENTIMENT[0]] = STRONG_NEGATIVE_SENTIMENT[1]
    if rating is not None and rating == rating and rating <= 1:
        hits[ONE_STAR[0]] = ONE_STAR[1]
    return hits


def severity_score(text: str, sentiment: float, rating: float | None = None) -> tuple[float, dict[str, float]]:
    hits = severity_signals(text, sentiment, rating)
    # Positive feedback that merely mentions a keyword is not a severe issue.
    if sentiment >= 0.4 and (rating is None or rating != rating or rating >= 4):
        return 0.0, {}
    return min(1.0, sum(hits.values())), hits


def level_for(score: float) -> str:
    for threshold, name in LEVELS:
        if score >= threshold:
            return name
    return "low"


#: Theme-level cut-offs applied to the MEAN severity score of a theme's negative feedback.
#: Means are lower than single-review scores, so thresholds are lower than LEVELS.
THEME_LEVELS = [(0.50, "critical"), (0.38, "high"), (0.25, "medium"), (0.0, "low")]


def theme_level_for(mean_score: float) -> str:
    for threshold, name in THEME_LEVELS:
        if mean_score >= threshold:
            return name
    return "low"


LEVEL_ORDER ={"low": 0, "medium": 1, "high": 2, "critical": 3}
