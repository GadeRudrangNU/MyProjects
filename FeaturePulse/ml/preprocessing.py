"""Cleaning, quality filtering and schema normalization for raw feedback."""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field

import pandas as pd

from ml import config

_URL = re.compile(r"https?://\S+|www\.\S+")
_EMAIL = re.compile(r"\S+@\S+\.\S+")
_REPEAT = re.compile(r"(.)\1{3,}")
_WS = re.compile(r"\s+")
_NONALNUM = re.compile(r"[^a-z0-9 ]+")

# Function words used as a cheap, dependency-free English detector.
_EN_FUNCTION_WORDS = frozenset(
    "the a an and or but is are was were be it its this that to of in on for with not no "
    "i my me you your we they have has had do does did can cant cannot will would just "
    "so very too app please when after before all".split()
)


def clean_text(text: str | None) -> str:
    """Normalize a raw review: strip URLs/emails, squeeze repeated characters and whitespace."""
    if text is None:
        return ""
    t = str(text)
    t = _URL.sub(" ", t)
    t = _EMAIL.sub(" ", t)
    t = _REPEAT.sub(r"\1\1\1", t)  # "soooooo" -> "sooo"
    t = _WS.sub(" ", t).strip()
    return t


def dedupe_key(text: str) -> str:
    """Key under which two reviews are considered exact duplicates."""
    return _WS.sub(" ", _NONALNUM.sub(" ", text.lower())).strip()


def looks_english(text: str) -> bool:
    if not text:
        return False
    ascii_ratio = sum(c.isascii() for c in text) / len(text)
    if ascii_ratio < 0.95:
        return False
    tokens = re.findall(r"[a-z']+", text.lower())
    if not tokens:
        return False
    hits = sum(t in _EN_FUNCTION_WORDS for t in tokens)
    return hits >= 1 and hits / len(tokens) >= 0.08


def is_informative(text: str) -> bool:
    words = text.split()
    if len(words) < config.MIN_WORDS or len(text) < config.MIN_CHARS or len(text) > config.MAX_CHARS:
        return False
    letters = sum(c.isalpha() for c in text)
    return letters / len(text) >= 0.6


@dataclass
class CleaningReport:
    raw_records: int = 0
    unparseable_date: int = 0
    empty_text: int = 0
    too_short_or_noisy: int = 0
    non_english: int = 0
    exact_duplicates_consolidated: int = 0
    kept_before_sampling: int = 0
    kept_after_sampling: int = 0
    extra: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items()}


def feedback_id(source: str, product_area: str | None, date: str, text: str) -> str:
    """Deterministic id so reruns of the pipeline yield stable ids."""
    h = hashlib.sha1(f"{source}|{product_area}|{date}|{text}".encode()).hexdigest()
    return h[:16]


def clean_dataframe(df: pd.DataFrame, text_col="text", date_col="created_at") -> tuple[pd.DataFrame, CleaningReport]:
    """Apply cleaning + quality filters + exact dedup. Input needs `text`, `created_at` columns.

    Rows are never fabricated: unknown columns stay null.
    """
    rep = CleaningReport(raw_records=len(df))
    out = df.copy()
    out[date_col] = pd.to_datetime(out[date_col], errors="coerce")
    rep.unparseable_date = int(out[date_col].isna().sum())
    out = out.dropna(subset=[date_col])

    out["text"] = out[text_col].map(clean_text)
    empty = out["text"].str.len() == 0
    rep.empty_text = int(empty.sum())
    out = out[~empty]

    ok = out["text"].map(is_informative)
    rep.too_short_or_noisy = int((~ok).sum())
    out = out[ok]

    en = out["text"].map(looks_english)
    rep.non_english = int((~en).sum())
    out = out[en]

    out["_key"] = out["text"].map(dedupe_key)
    sizes = out.groupby("_key")["text"].transform("size")
    out["duplicate_count"] = sizes - 1
    before = len(out)
    out = out.sort_values(date_col).drop_duplicates("_key", keep="first").drop(columns="_key")
    rep.exact_duplicates_consolidated = before - len(out)
    rep.kept_before_sampling = len(out)
    return out.reset_index(drop=True), rep


def cap_per_group(df: pd.DataFrame, group_col: str, cap: int, seed: int = config.RANDOM_SEED) -> pd.DataFrame:
    """Random cap per group (e.g. per app) so one product cannot dominate the corpus."""
    parts = []
    for _, g in df.groupby(group_col, sort=False):
        parts.append(g if len(g) <= cap else g.sample(cap, random_state=seed))
    return pd.concat(parts).sort_values("created_at").reset_index(drop=True)
