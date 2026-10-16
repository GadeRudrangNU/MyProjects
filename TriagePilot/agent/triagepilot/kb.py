import html
import re

import numpy as np

from .schemas import Article

_TAGS = re.compile(r"<[^>]+>")


def plain(text: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(_TAGS.sub(" ", text or ""))).strip()


class KnowledgeBase:
    """Published knowledge articles from the instance, embedded for similarity search."""

    KIND = "kb"

    def __init__(self, store, embedder, sn=None):
        self.store, self.embedder, self.sn = store, embedder, sn

    def sync(self) -> int:
        records = self.sn.published_articles()
        rows, texts = [], []
        for r in records:
            body = plain(r.get("text", ""))
            title = r.get("short_description", "")
            rows.append({"ref": r["number"], "text": f"{title}. {body}", "category": "", "meta": {"title": title, "body": body}})
            texts.append(f"{title}. {body}")
        vectors = self.embedder.encode(texts) if texts else np.zeros((0, 384), dtype=np.float32)
        self.store.replace(self.KIND, rows, vectors)
        return len(rows)

    def search(self, vector: np.ndarray, k: int) -> list[Article]:
        """Published articles only; drafts are kept for the duplicate check but never shown to employees."""
        hits = [h for h in self.store.search(self.KIND, vector, k + 10) if h.meta.get("state") != "draft"]
        return [Article(id=h.ref, title=h.meta.get("title", ""), text=h.meta.get("body", h.text), score=round(h.score, 4)) for h in hits[:k]]

    def nearest_score(self, vector: np.ndarray) -> tuple[str | None, float]:
        hits = self.store.search(self.KIND, vector, 1)
        return (hits[0].ref, hits[0].score) if hits else (None, 0.0)

    def add_draft(self, number: str, title: str, body: str):
        text = f"{title}. {body}"
        row = {"ref": number, "text": text, "category": "", "meta": {"title": title, "body": body, "state": "draft"}}
        self.store.add(self.KIND, row, self.embedder.encode([text])[0])
