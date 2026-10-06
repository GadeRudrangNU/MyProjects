"""Theme labeling without any LLM: class-based TF-IDF keywords + representative feedback."""
from __future__ import annotations

import re

import numpy as np
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, CountVectorizer

# Words that carry no theme information in app-store feedback.
DOMAIN_STOPWORDS = {
    "app", "apps", "application", "android", "phone", "please", "pls", "plz", "good", "great", "nice", "best",
    "love", "like", "really", "just", "use", "using", "used", "work", "works", "working", "ve", "don", "doesn",
    "didn", "isn", "ll", "make", "need", "want", "thanks", "thank", "excellent", "awesome", "amazing", "ok",
    "okay", "better", "little", "lot", "bit", "way", "time", "know", "think", "get", "got", "does", "did",
    "doesnt", "dont", "cant", "im", "ive", "star", "stars", "update", "updated", "version", "perfect",
    "fantastic", "wonderful", "cool", "fine", "wish", "hope", "far", "ever", "especially", "much", "many",
    # contractions (apostrophes are stripped before vectorizing, so they appear without them)
    "its", "ive", "dont", "doesnt", "didnt", "cant", "wont", "isnt", "wasnt", "couldnt", "wouldnt", "thats",
    "youre", "theyre", "thing", "things", "stuff", "everything", "anything", "guys", "people", "ones",
}
STOPWORDS = sorted(set(ENGLISH_STOP_WORDS) | DOMAIN_STOPWORDS)


def ctfidf_keywords(texts: list[str], labels: np.ndarray, top_n: int = 12, min_count: int = 5) -> dict[int, list[tuple[str, float]]]:
    """BERTopic-style class-based TF-IDF: one 'document' per cluster, terms scored by distinctiveness.

    Terms must occur at least `min_count` times in total (not in several clusters -- terms unique to one
    cluster are exactly the distinctive ones). Falls back to min_count=1 on very small inputs."""
    labels = np.asarray(labels)
    classes = sorted(c for c in set(labels.tolist()) if c != -1)
    docs = [" ".join(t.replace("'", "").replace("’", "") for t, l in zip(texts, labels) if l == c) for c in classes]
    vec = CountVectorizer(stop_words=STOPWORDS, ngram_range=(1, 2), min_df=1, max_features=200000,
                          token_pattern=r"(?u)\b[a-zA-Z]{3,}\b")
    X = vec.fit_transform(docs).astype(np.float64)
    terms = np.array(vec.get_feature_names_out())
    totals = np.asarray(X.sum(axis=0)).ravel()
    keep = totals >= (min_count if (totals >= min_count).sum() >= 10 else 1)
    X, terms = X[:, np.where(keep)[0]], terms[keep]
    row_sums = np.maximum(np.asarray(X.sum(axis=1)).ravel(), 1)
    tf = X.multiply(1.0 / row_sums[:, None]).tocsr()
    avg_words = X.sum() / max(len(classes), 1)
    total_tf = np.asarray(X.sum(axis=0)).ravel()
    idf = np.log(1 + avg_words / np.maximum(total_tf, 1))
    scores = tf.multiply(idf).toarray()
    out = {}
    for i, c in enumerate(classes):
        idx = np.argsort(-scores[i])[: top_n * 3]
        out[int(c)] = [(str(terms[j]), float(scores[i, j])) for j in idx if scores[i, j] > 0]
    return out


def distinct_keywords(scored: list[tuple[str, float]], n: int = 6) -> list[str]:
    """Keep top terms but drop ones whose words are already covered (e.g. 'upload' then 'upload photo')."""
    chosen: list[str] = []
    seen: set[str] = set()
    for term, _ in scored:
        words = set(term.split())
        if words <= seen:
            continue
        chosen.append(term)
        seen |= words
        if len(chosen) == n:
            break
    return chosen


def make_label(keywords: list[str], n: int = 3) -> str:
    """Readable label from the top distinct keywords, e.g. 'Battery Drain / Wakelock / Services'."""
    parts = [k.title() for k in keywords[:n]]
    return " / ".join(parts) if parts else "Unlabeled"


def representative_indices(embeddings: np.ndarray, member_idx: np.ndarray, texts: list[str], k: int = 5) -> list[int]:
    """Members closest to the cluster centroid, preferring readable, distinct, mid-length reviews."""
    sub = embeddings[member_idx]
    centroid = sub.mean(axis=0)
    centroid /= max(np.linalg.norm(centroid), 1e-12)
    sims = sub @ centroid
    picked, seen = [], set()
    for j in np.argsort(-sims):
        t = texts[member_idx[j]]
        key = re.sub(r"\W+", " ", t.lower())[:60]
        if key in seen or not (25 <= len(t) <= 400):
            continue
        seen.add(key)
        picked.append(int(member_idx[j]))
        if len(picked) == k:
            break
    return picked
