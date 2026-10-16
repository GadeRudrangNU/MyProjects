"""Runs the workflow against answers recorded from the real local model.

Normal runs replay the recorded answers, so CI needs no model. After changing a prompt, record again with a model running:
    TP_RECORD=1 pytest tests/test_recorded_model.py
"""

import os

import pytest

from conftest import ROOT, FakeClassifier
from triagepilot.config import Settings
from triagepilot.graph import build_graph, run_triage
from triagepilot.knowledge_agent import KnowledgeAgent, ResolvedIncident
from triagepilot.llm import CassetteMiss, StructuredLlm
from triagepilot.schemas import ASSIGNMENT_GROUPS, TriageRequest

CASSETTE = ROOT / "agent" / "tests" / "cassettes" / "llm.json"
RECORDING = bool(os.environ.get("TP_RECORD"))


@pytest.fixture
def recorded_llm(settings):
    s = Settings(**{**settings.model_dump(), "llm_mode": "record" if RECORDING else "replay", "llm_cassette": CASSETTE})
    return StructuredLlm(s)


def req(short, desc, n=0):
    return TriageRequest(incident_sys_id=f"{n:032d}", number=f"INC{n}", short_description=short, description=desc, priority=3, mod_count=0, run_sys_id="f" * 32)


def triage(deps, request):
    try:
        return run_triage(build_graph(deps), request, f"k{request.number}")
    except CassetteMiss as exc:
        pytest.fail(f"{exc}. Record again with TP_RECORD=1 while Ollama is running.")


def check_grounded(result, deps):
    retrieved = {a["number"] for a in deps.sn.published_articles()}
    assert set(result.cited_articles) <= retrieved
    assert result.category in ASSIGNMENT_GROUPS and result.assignment_group == ASSIGNMENT_GROUPS[result.category]
    assert result.reply_draft and "cited_articles" not in result.reply_draft


def test_confident_ticket_gets_a_grounded_reply(make_deps, recorded_llm):
    deps = make_deps(classifier=FakeClassifier((("Hardware", 0.96), ("Storage", 0.03), ("Access", 0.01))), llm=recorded_llm)
    result = triage(deps, req("Laptop will not start", "My laptop shows a black screen and the charging light blinks.", 1))
    assert result.status == "completed" and result.path == "fast" and result.category == "Hardware"
    check_grounded(result, deps)


def test_unsure_ticket_is_decided_among_the_top_three(make_deps, recorded_llm):
    clf = FakeClassifier((("Hardware", 0.46), ("Storage", 0.34), ("Access", 0.2)))
    deps = make_deps(classifier=clf, llm=recorded_llm)
    result = triage(deps, req("Disk is full", "My laptop says there is no space left on drive C and updates fail.", 2))
    assert result.path == "llm"
    assert result.category in ("Hardware", "Storage", "Access")
    assert result.confidence == dict(clf.top3)[result.category]
    check_grounded(result, deps)


def test_a_resolved_ticket_becomes_a_draft_article(make_deps, recorded_llm):
    deps = make_deps(llm=recorded_llm)
    agent = KnowledgeAgent(recorded_llm, deps.kb, deps.embedder, deps.sn, 0.85)
    inc = ResolvedIncident(
        incident_sys_id="e" * 32, number="INC9", short_description="Badge reader at the car park gate rejects cards",
        description="Several people report the reader at the car park gate shows a red light.", category="Hardware",
        close_notes="The reader had lost its network link. Reseated the network cable in the gate cabinet and restarted the reader. Cards work again.",
    )
    try:
        out = agent.run(inc)
    except CassetteMiss as exc:
        pytest.fail(f"{exc}. Record again with TP_RECORD=1 while Ollama is running.")
    assert out.status == "drafted"
    draft = deps.sn.drafts[0]
    assert draft["short_description"] and "<ol>" in draft["text"] and draft["u_source_incident"] == "e" * 32
