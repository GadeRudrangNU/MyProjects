import pytest

from conftest import GOOD_REPLY, FakeClassifier, StubLlm
from triagepilot.graph import build_graph, run_triage
from triagepilot.llm import LlmUnavailable
from triagepilot.schemas import TriageRequest

REQ = TriageRequest(
    incident_sys_id="a" * 32,
    number="INC1000001",
    short_description="Laptop will not start",
    description="Black screen since this morning, call me on 617-555-0142 or write to x@y.com",
    priority=3,
    mod_count=0,
    run_sys_id="b" * 32,
)


def run(deps):
    return run_triage(build_graph(deps), REQ, "key:0")


def test_fast_path_skips_the_category_llm_call(make_deps):
    llm = StubLlm(draft=GOOD_REPLY)
    result = run(make_deps(llm=llm))
    assert result.status == "completed"
    assert result.path == "fast" and result.category == "Hardware"
    assert result.assignment_group == "TP Hardware Support"
    assert [t for t, _ in llm.calls] == ["draft"]
    assert [s.step for s in result.trace][:5] == ["normalize", "classify", "retrieve", "decide", "draft"]
    assert result.cited_articles == ["KB0010011"]


def test_pii_never_reaches_the_llm(make_deps):
    llm = StubLlm(draft=GOOD_REPLY)
    run(make_deps(llm=llm))
    sent = " ".join(u for _, u in llm.calls)
    assert "617-555" not in sent and "x@y.com" not in sent
    assert "[PHONE]" in sent and "[EMAIL]" in sent


def test_low_confidence_uses_llm_and_stays_inside_top3(make_deps):
    clf = FakeClassifier((("Hardware", 0.5), ("Storage", 0.3), ("Access", 0.2)))
    llm = StubLlm(decide={"category": "Storage", "reason": "The ticket is about disk space."}, draft=GOOD_REPLY)
    result = run(make_deps(clf, llm))
    assert result.path == "llm" and result.category == "Storage"
    assert result.confidence == 0.3
    assert "Similar past tickets" in dict((t, u) for t, u in llm.calls)["decide"]


def test_llm_answer_outside_candidates_is_retried_then_needs_review(make_deps):
    clf = FakeClassifier((("Hardware", 0.5), ("Storage", 0.3), ("Access", 0.2)))
    llm = StubLlm(decide={"category": "Purchase", "reason": "buy something"}, draft=GOOD_REPLY)
    result = run(make_deps(clf, llm))
    assert result.status == "needs_review"
    assert result.attempts == 2
    assert any("not one of" in e for e in result.errors)
    assert result.category == "Hardware"
    assert [t for t, _ in llm.calls].count("decide") == 2
    assert "previous answer was rejected" in llm.calls[2][1] or "previous reply was rejected" in llm.calls[3][1]


def test_invented_category_fails_schema_and_is_flagged(make_deps):
    clf = FakeClassifier((("Hardware", 0.5), ("Storage", 0.3), ("Access", 0.2)))
    llm = StubLlm(decide={"category": "Printers", "reason": "x"}, draft=GOOD_REPLY)
    result = run(make_deps(clf, llm))
    assert result.status == "needs_review"
    assert any("invalid" in e for e in result.errors)


def test_hallucinated_citation_is_retried_and_can_recover(make_deps):
    bad = {"reply": "See KB9999999 for the steps to follow here.", "cited_articles": ["KB9999999"]}
    llm = StubLlm(draft=[bad, GOOD_REPLY])
    result = run(make_deps(llm=llm))
    assert result.status == "completed"
    assert result.attempts == 2
    assert result.cited_articles == ["KB0010011"]


def test_citation_inside_reply_text_is_checked(make_deps):
    sneaky = {"reply": "Please follow KB0099999 which explains everything.", "cited_articles": []}
    llm = StubLlm(draft=sneaky)
    result = run(make_deps(llm=llm))
    assert result.status == "needs_review"
    assert any("KB0099999" in e for e in result.errors)
    assert result.cited_articles == []


def test_reply_with_personal_data_is_rejected(make_deps):
    leaky = {"reply": "Thanks, we will email you at someone@example.com shortly.", "cited_articles": []}
    result = run(make_deps(llm=StubLlm(draft=leaky)))
    assert result.status == "needs_review"
    assert "reply contains personal data" in result.errors


def test_unknown_assignment_group_fails_validation(make_deps):
    deps = make_deps(llm=StubLlm(draft=GOOD_REPLY))
    deps.known_groups = {"TP Storage Team"}
    result = run(deps)
    assert result.status == "needs_review"
    assert any("assignment group" in e for e in result.errors)


def test_llm_down_keeps_fast_path_working_with_a_template_reply(make_deps):
    llm = StubLlm(draft=LlmUnavailable("connection refused"))
    result = run(make_deps(llm=llm))
    assert result.status == "completed"
    assert result.cited_articles and result.cited_articles[0].startswith("KB")
    assert "TP Hardware Support" in result.reply_draft


def test_llm_down_on_low_confidence_keeps_the_classifier_guess(make_deps):
    clf = FakeClassifier((("Hardware", 0.5), ("Storage", 0.3), ("Access", 0.2)))
    llm = StubLlm(decide=LlmUnavailable("down"), draft=LlmUnavailable("down"))
    result = run(make_deps(clf, llm))
    assert result.category == "Hardware" and result.path == "llm"
    assert result.status == "completed"
    assert "unavailable" in result.reasoning


def test_callback_payload_goes_to_servicenow(make_deps):
    deps = make_deps(llm=StubLlm(draft=GOOD_REPLY))
    result = run(deps)
    assert len(deps.sn.results) == 1
    sent = deps.sn.results[0]
    assert sent["run_sys_id"] == "b" * 32 and sent["category"] == "Hardware" and sent["status"] == "completed"
    assert result.latency_ms == sent["latency_ms"] or sent["latency_ms"] >= 0


def test_similar_tickets_can_exclude_the_test_split(make_deps):
    deps = make_deps(llm=StubLlm(draft=GOOD_REPLY))
    deps.settings.retrieval_exclude_splits = ["test"]
    result = run(deps)
    assert "T00004" not in result.similar_incidents


def test_field_names_leaking_into_the_reply_are_removed(make_deps):
    leaky = {"reply": "Please hold the power button for ten seconds. See KB0010011 for details. cited_articles: KB0010011", "cited_articles": ["KB0010011"]}
    result = run(make_deps(llm=StubLlm(draft=leaky)))
    assert result.status == "completed"
    assert "cited_articles" not in result.reply_draft
    assert result.reply_draft.endswith("for details.")
