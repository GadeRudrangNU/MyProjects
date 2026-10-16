"""Brings natural ticket text to the same shape as the training data: lowercase,
no punctuation, no stopwords, plural/verb endings trimmed."""

import re

from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS

_TOKEN = re.compile(r"[a-z]+")
_PLACEHOLDER = re.compile(r"\[(?:EMAIL|IP|PHONE)\]")
_STOP = set(ENGLISH_STOP_WORDS) | {"hi", "hello", "dear", "please", "thanks", "thank", "regards", "kind", "best"}


def _lemma(word: str) -> str:
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith(("sses", "xes", "ches", "shes")):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith(("ss", "us", "is")):
        return word[:-1]
    if len(word) > 5 and word.endswith("ing"):
        return word[:-3]
    if len(word) > 4 and word.endswith("ed"):
        return word[:-2]
    return word


def normalize(text: str) -> str:
    text = _PLACEHOLDER.sub(" ", text.lower())
    words = (_lemma(w) for w in _TOKEN.findall(text))
    return " ".join(w for w in words if w not in _STOP and len(w) > 1)
