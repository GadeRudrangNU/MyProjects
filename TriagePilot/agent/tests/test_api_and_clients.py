import json
import time

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from conftest import GOOD_REPLY, FakeClassifier, StubLlm
from triagepilot.api import create_app
from triagepilot.config import Settings
from triagepilot.knowledge_agent import KnowledgeAgent, ResolvedIncident
from triagepilot.llm import CassetteMiss, LlmUnavailable, StructuredLlm
from triagepilot.runs import RunStore
from triagepilot.schemas import LlmCategoryChoice
from triagepilot.service import TriageService
from triagepilot.snclient import ServiceNowClient

BODY = {
    "incident_sys_id": "a" * 32,
    "number": "INC1000002",
    "short_description": "Laptop will not start",
    "description": "Black screen",
    "priority": 3,
    "mod_count": 0,
    "run_sys_id": "b" * 32,
}
AUTH = {"Authorization": "Bearer t"}


@pytest.fixture
def client(make_deps, settings):
    deps = make_deps(llm=StubLlm(draft=GOOD_REPLY))
    service = TriageService(deps, RunStore(settings.runs_db))
    with TestClient(create_app(settings, service)) as c:
        c.deps = deps
        c.service = service
        yield c


def wait_for(client, key, timeout=5):
    end = time.time() + timeout
    while time.time() < end:
        row = client.get(f"/v1/runs/{key}", headers=AUTH).json()
        if row["status"] not in ("queued", "running"):
            return row
        time.sleep(0.05)
    raise AssertionError("run did not finish")


def test_requires_token(client):
    assert client.post("/v1/triage", json=BODY).status_code == 401
    assert client.post("/v1/triage", json=BODY, headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_accepts_with_202_then_posts_the_callback(client):
    r = client.post("/v1/triage", json=BODY, headers=AUTH)
    assert r.status_code == 202
    assert r.json() == {"run_key": f"{'a' * 32}:0", "status": "queued", "duplicate": False}
    row = wait_for(client, r.json()["run_key"])
    assert row["status"] == "completed"
    assert len(client.deps.sn.results) == 1


def test_same_incident_revision_runs_once(client):
    first = client.post("/v1/triage", json=BODY, headers=AUTH).json()
    second = client.post("/v1/triage", json=BODY, headers=AUTH).json()
    assert second["duplicate"] is True and second["run_key"] == first["run_key"]
    wait_for(client, first["run_key"])
    assert len(client.deps.sn.results) == 1
    again = client.post("/v1/triage", json={**BODY, "mod_count": 1}, headers=AUTH).json()
    assert again["duplicate"] is False


def test_rejects_unknown_fields_and_bad_priority(client):
    assert client.post("/v1/triage", json={**BODY, "extra": 1}, headers=AUTH).status_code == 422
    assert client.post("/v1/triage", json={k: v for k, v in BODY.items() if k != "number"}, headers=AUTH).status_code == 422


def test_a_crash_marks_the_run_failed_and_tells_servicenow(client):
    class Boom:
        def invoke(self, *_a, **_k):
            raise RuntimeError("graph exploded")

    client.service.graph = Boom()
    key = client.post("/v1/triage", json=BODY, headers=AUTH).json()["run_key"]
    row = wait_for(client, key)
    assert row["status"] == "failed" and "exploded" in row["error"]
    assert client.deps.sn.results[-1]["status"] == "failed"


def test_unknown_run_is_404(client):
    assert client.get("/v1/runs/nope", headers=AUTH).status_code == 404


def test_knowledge_endpoint_returns_202_and_reports_back(client):
    inc = {"incident_sys_id": "c" * 32, "number": "INC1000009", "short_description": "Docking station will not charge", "description": "No power to the laptop", "category": "Hardware", "close_notes": "Replaced the power brick with a 130W unit and updated the dock firmware."}
    client.deps.llm.answers["article"] = [{"title": "Docking station does not charge the laptop", "symptoms": "The laptop drains while docked.", "resolution_steps": ["Swap the power brick for a 130W one.", "Update the dock firmware."]}]
    r = client.post("/v1/knowledge/draft", json=inc, headers=AUTH)
    assert r.status_code == 202
    end = time.time() + 5
    while time.time() < end and not client.deps.sn.knowledge_results:
        time.sleep(0.05)
    assert client.deps.sn.knowledge_results[0]["status"] == "drafted"


# ---- knowledge agent ----

def make_agent(deps, llm):
    return KnowledgeAgent(llm, deps.kb, deps.embedder, deps.sn, 0.9)


RESOLVED = ResolvedIncident(
    incident_sys_id="d" * 32, number="INC1000010", short_description="Disk full on laptop", description="No space left on drive C",
    category="Storage", close_notes="Cleared the temp folders and moved the archive to the network drive. Call 617-555-0142 if it returns.",
)
ARTICLE = {"title": "Free up space on a full laptop disk", "symptoms": "Updates fail because the disk is full.", "resolution_steps": ["Clear the temp folders.", "Move the archive to the network drive."]}


def test_knowledge_agent_drafts_an_article(make_deps):
    deps = make_deps()
    out = make_agent(deps, StubLlm(article=ARTICLE)).run(RESOLVED)
    assert out.status == "drafted" and out.article_number
    body = deps.sn.drafts[0]
    assert body["u_source_incident"] == "d" * 32 and "<ol>" in body["text"]


def test_knowledge_agent_scrubs_personal_data_before_the_llm(make_deps):
    deps = make_deps()
    llm = StubLlm(article=ARTICLE)
    make_agent(deps, llm).run(RESOLVED)
    assert "617-555" not in llm.calls[0][1]


def test_knowledge_agent_skips_near_duplicates(make_deps):
    deps = make_deps()
    dup = RESOLVED.model_copy(update={"short_description": "Ask for more space on a shared drive", "description": "", "close_notes": "Raise a storage request with the new size."})
    llm = StubLlm()
    out = make_agent(deps, llm).run(dup)
    assert out.status == "skipped_duplicate" and out.nearest == "KB0010021"
    assert llm.calls == [] and deps.sn.drafts == []


def test_knowledge_agent_refuses_a_draft_with_personal_data(make_deps):
    deps = make_deps()
    leaky = {**ARTICLE, "symptoms": "Ask jo@example.com about the disk."}
    out = make_agent(deps, StubLlm(article=leaky)).run(RESOLVED)
    assert out.status == "failed" and deps.sn.drafts == []


def test_knowledge_agent_reports_llm_failure(make_deps):
    deps = make_deps()
    out = make_agent(deps, StubLlm(article=LlmUnavailable("down"))).run(RESOLVED)
    assert out.status == "failed"


# ---- ServiceNow client ----

def test_sn_client_retries_server_errors_and_sends_basic_auth():
    settings = Settings(sn_url="http://sn.test", sn_user="svc", sn_password="pw")
    with respx.mock(base_url="http://sn.test") as mock:
        route = mock.post("/api/x_tp/triage/result").mock(side_effect=[httpx.Response(503), httpx.Response(502), httpx.Response(200, json={"result": {"ok": True}})])
        out = ServiceNowClient(settings).post_result({"run_sys_id": "x"})
        assert out == {"ok": True} and route.call_count == 3
        assert route.calls.last.request.headers["authorization"].startswith("Basic ")


def test_sn_client_does_not_retry_client_errors():
    settings = Settings(sn_url="http://sn.test")
    with respx.mock(base_url="http://sn.test") as mock:
        route = mock.post("/api/x_tp/triage/result").mock(return_value=httpx.Response(403, json={"error": {"message": "no"}}))
        with pytest.raises(httpx.HTTPStatusError):
            ServiceNowClient(settings).post_result({})
        assert route.call_count == 1


def test_sn_client_reads_published_articles_only():
    settings = Settings(sn_url="http://sn.test")
    with respx.mock(base_url="http://sn.test") as mock:
        route = mock.get("/api/now/table/kb_knowledge").mock(return_value=httpx.Response(200, json={"result": [{"number": "KB1"}]}))
        assert ServiceNowClient(settings).published_articles() == [{"number": "KB1"}]
        assert route.calls.last.request.url.params["sysparm_query"] == "workflow_state=published"


# ---- LLM wrapper ----

def llm_settings(tmp_path, mode="live"):
    return Settings(ollama_url="http://ollama.test", llm_mode=mode, llm_cassette=tmp_path / "c.json")


def test_llm_parses_structured_json(tmp_path):
    with respx.mock(base_url="http://ollama.test") as mock:
        route = mock.post("/api/chat").mock(return_value=httpx.Response(200, json={"message": {"content": json.dumps({"category": "Storage", "reason": "disk"})}}))
        out = StructuredLlm(llm_settings(tmp_path)).run("t", "sys", "usr", LlmCategoryChoice)
        assert out.category == "Storage"
        sent = json.loads(route.calls.last.request.content)
        assert sent["format"]["properties"]["category"]["enum"][0] == "Access" and sent["options"]["temperature"] == 0.0


def test_llm_rejects_category_outside_the_enum(tmp_path):
    with respx.mock(base_url="http://ollama.test") as mock:
        mock.post("/api/chat").mock(return_value=httpx.Response(200, json={"message": {"content": json.dumps({"category": "Printers", "reason": "x"})}}))
        with pytest.raises(ValueError):
            StructuredLlm(llm_settings(tmp_path)).run("t", "s", "u", LlmCategoryChoice)


def test_llm_connection_errors_become_unavailable(tmp_path):
    with respx.mock(base_url="http://ollama.test") as mock:
        mock.post("/api/chat").mock(side_effect=httpx.ConnectError("refused"))
        with pytest.raises(LlmUnavailable):
            StructuredLlm(llm_settings(tmp_path)).run("t", "s", "u", LlmCategoryChoice)


def test_record_then_replay_is_deterministic(tmp_path):
    with respx.mock(base_url="http://ollama.test") as mock:
        mock.post("/api/chat").mock(return_value=httpx.Response(200, json={"message": {"content": json.dumps({"category": "Access", "reason": "login"})}}))
        StructuredLlm(llm_settings(tmp_path, "record")).run("t", "s", "u", LlmCategoryChoice)
    replay = StructuredLlm(llm_settings(tmp_path, "replay"))
    assert replay.run("t", "s", "u", LlmCategoryChoice).category == "Access"
    with pytest.raises(CassetteMiss):
        replay.run("t", "s", "different prompt", LlmCategoryChoice)


def test_a_drafted_article_blocks_a_second_draft_but_is_never_cited(make_deps):
    deps = make_deps()
    agent = make_agent(deps, StubLlm(article=ARTICLE))
    assert agent.run(RESOLVED).status == "drafted"
    again = agent.run(RESOLVED.model_copy(update={"number": "INC1000011"}))
    assert again.status == "skipped_duplicate"
    vec = deps.embedder.encode(["Free up space on a full laptop disk. Updates fail because the disk is full."])[0]
    assert all(a.id != again.nearest for a in deps.kb.search(vec, 5))
