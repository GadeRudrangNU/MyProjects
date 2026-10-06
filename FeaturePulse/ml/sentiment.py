"""Sentiment: VADER (lexicon, no model download) blended with the star rating as a weak signal."""
from __future__ import annotations

from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

from ml import config

_analyzer = SentimentIntensityAnalyzer()


def vader_score(text: str) -> float:
    return float(_analyzer.polarity_scores(text)["compound"])


def rating_signal(rating: float | None) -> float | None:
    """Map a 1-5 rating to [-1, 1]. Unknown stays unknown."""
    if rating is None or rating != rating:  # None or NaN
        return None
    return (float(rating) - 3.0) / 2.0


def sentiment_score(text: str, rating: float | None = None) -> float:
    v = vader_score(text)
    r = rating_signal(rating)
    if r is None:
        return v
    return (1 - config.RATING_WEIGHT) * v + config.RATING_WEIGHT * r


def sentiment_label(score: float) -> str:
    if score <= config.NEG_THRESHOLD:
        return "negative"
    if score >= config.POS_THRESHOLD:
        return "positive"
    return "neutral"
