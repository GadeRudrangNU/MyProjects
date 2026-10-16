import json
from pathlib import Path

import numpy as np
import pytest

from triagepilot.config import Settings
from triagepilot.embeddings import HashEmbedder
from triagepilot.graph import Deps
from triagepilot.kb import KnowledgeBase
from triagepilot.vectorstore import NumpyStore

FIXTURES = Path(__file__).parent / "fixtures"
ROOT = Path(__file__).resolve().parents[2]


class FakeClassifier:
    classes = ["Access", "Administrative rights", "HR Support", "Hardware", "Internal Project", "Miscellaneous", "Purchase", "Storage"]

    def __init__(self, top3=(("Hardware", 0.95), ("Storage", 0.03), ("Access", 0.02))):
        self.top3 = [tuple(x) for x in top3]

    def top_k(self, text, k=3):
        return self.top3[:k]


class StubLlm:
    """Plays back scripted answers per task; records every call."""

    def __init__(self, **answers):
        self.answers = {k: list(v) if isinstance(v, list) else [v] for k, v in answers.items()}
        self.calls: list[tuple[str, str]] = []

    def run(self, task, system, user, schema):
        self.calls.append((task, user))
        queue = self.answers.get(task)
        if not queue:
            raise AssertionError(f"unexpected LLM call for {task}")
        item = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(item, Exception):
            raise item
        return schema.model_validate(item)


ARTICLES = [
    {"number": "KB0010011", "short_description": "Laptop will not start or is very slow", "text": "<p>Hold the power button for ten seconds and try again with the charger only.</p>"},
    {"number": "KB0010012", "short_description": "Printer is offline or not printing", "text": "<p>Re-add the printer from the print portal.</p>"},
    {"number": "KB0010021", "short_description": "Ask for more space on a shared drive", "text": "<p>Raise a storage request with the new size.</p>"},
]


class FakeSn:
    def __init__(self):
        self.results: list[dict] = []
        self.knowledge_results: list[dict] = []
        self.drafts: list[dict] = []

    def post_result(self, payload):
        self.results.append(payload)
        return {"ok": True}

    def post_knowledge_result(self, payload):
        self.knowledge_results.append(payload)
        return {"ok": True}

    def published_articles(self):
        return ARTICLES

    def create_article_draft(self, body):
        self.drafts.append(body)
        return {"number": f"KB00200{len(self.drafts):02d}", **body}


@pytest.fixture
def settings(tmp_path):
    return Settings(embedder="hash", artifacts_dir=tmp_path / "art", runtime_dir=tmp_path / "rt", llm_mode="live", retrieval_exclude_splits=[], api_token="t")


@pytest.fixture
def make_deps(settings):
    def _make(classifier=None, llm=None, sn=None):
        embedder = HashEmbedder()
        store = NumpyStore(settings.vectors_dir)
        sn = sn or FakeSn()
        kb = KnowledgeBase(store, embedder, sn)
        kb.sync()
        rows = [
            {"ref": "T00001", "text": "laptop battery drains fast and the screen flickers", "category": "Hardware", "split": "train"},
            {"ref": "T00002", "text": "need more space on the shared drive quota full", "category": "Storage", "split": "train"},
            {"ref": "T00003", "text": "reset my password account locked out", "category": "Access", "split": "train"},
            {"ref": "T00004", "text": "laptop will not start black screen", "category": "Hardware", "split": "test"},
        ]
        store.replace("ticket", rows, embedder.encode([r["text"] for r in rows]))
        return Deps(settings=settings, classifier=classifier or FakeClassifier(), embedder=embedder, store=store, kb=kb, llm=llm or StubLlm(), sn=sn)

    return _make


GOOD_REPLY = {"reply": "Thanks for reporting this. Please hold the power button for ten seconds and try again with only the charger connected.", "cited_articles": ["KB0010011"]}
