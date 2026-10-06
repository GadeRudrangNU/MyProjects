"""API + service tests against a real PostgreSQL/pgvector instance with a small deterministic corpus."""
import io

import pytest


@pytest.fixture()
def c(client_env, fake_embedder, monkeypatch):
    # API code imports get_embedder lazily; swap in the offline fake for the duration of each API test only.
    import ml.embeddings as emb
    monkeypatch.setattr(emb, "get_embedder", lambda *a, **k: fake_embedder)
    return client_env[0]


def test_health_reports_pgvector(c):
    r = c.get("/api/health").json()
    assert r["status"] == "ok" and r["pgvector"] and r["feedback_records"] > 0


def test_dashboard_numbers_come_from_data(c, client_env):
    d = c.get("/api/dashboard").json()
    assert d["total_feedback"] == len(client_env[1])
    assert d["themes"] == 3
    assert d["evaluation"].get("status") in ("pending", "completed")
    assert d["synthetic_records"] == d["total_feedback"]     # the fixture corpus is flagged synthetic


def test_theme_list_filters_and_sorting(c):
    all_ = c.get("/api/themes?kind=").json()
    assert {t["label"] for t in all_} >= {"Photo Upload Failure", "Login Loop", "Dark Mode Request"}
    assert [t["id"] for t in c.get("/api/themes?kind=&q=login").json()] == [2]
    # source filter re-counts mentions on the filtered feedback
    f = c.get("/api/themes?kind=&source=test_fixture").json()
    assert all(t["filtered_mentions"] == t["mentions"] for t in f)
    assert c.get("/api/themes?kind=&source=nonexistent").json() == []


def test_emerging_flags_only_the_spiking_theme(c):
    r = c.get("/api/emerging").json()
    assert [t["label"] for t in r["items"]] == ["Photo Upload Failure"]
    assert r["items"][0]["z_score"] >= 2 and r["items"][0]["absolute_increase"] > 0


def test_rename_persists_and_can_be_reset(c):
    r = c.patch("/api/themes/3", json={"label": "Night Mode"}).json()
    assert r["label"] == "Night Mode" and r["generated_label"] == "Dark Mode Request"
    assert c.get("/api/themes/3").json()["label"] == "Night Mode"            # persisted in DB
    assert any(t["label"] == "Night Mode" and t["pm_label"] for t in c.get("/api/themes?kind=").json())
    c.patch("/api/themes/3", json={"label": ""})
    assert c.get("/api/themes/3").json()["label"] == "Dark Mode Request"


def test_theme_patch_validation(c):
    assert c.patch("/api/themes/1", json={"severity_override": "apocalyptic"}).status_code == 400
    assert c.patch("/api/themes/1", json={"strategic_fit": 11}).status_code == 422
    assert c.patch("/api/themes/999", json={"label": "x"}).status_code == 404


def test_priorities_weights_reorder_and_breakdown_is_exact(c):
    base = dict(frequency=0, severity=0, trend=0, customer_impact=0, sentiment=0, strategic_fit=0)
    by_trend = c.post("/api/priorities/recalculate", json={"weights": {**base, "trend": 1}}).json()["items"]
    assert by_trend[0]["label"] == "Photo Upload Failure"                    # the spiking theme wins on trend
    by_sev = c.post("/api/priorities/recalculate", json={"weights": {**base, "severity": 1}}).json()["items"]
    assert by_sev[0]["components"]["severity"] >= by_sev[-1]["components"]["severity"]
    for r in by_trend:
        assert sum(r["contributions"].values()) == pytest.approx(r["priority"], abs=0.05)


def test_save_weights_persist_and_bad_weights_rejected(c):
    w = dict(frequency=1, severity=2, trend=3, customer_impact=4, sentiment=5, strategic_fit=6)
    c.post("/api/priorities/recalculate", json={"weights": w, "save": True})
    assert c.get("/api/priorities").json()["weights"]["trend"] == 3
    assert c.post("/api/priorities/recalculate", json={"weights": {**w, "trend": -1}, "save": True}).status_code == 422
    c.post("/api/priorities/recalculate", json={"weights": dict(frequency=25, severity=20, trend=15, customer_impact=15, sentiment=10, strategic_fit=15), "save": True})


def test_ignored_theme_leaves_the_ranking(c):
    c.patch("/api/themes/3", json={"ignored": True})
    assert 3 not in [r["theme_id"] for r in c.get("/api/priorities").json()["items"]]
    c.patch("/api/themes/3", json={"ignored": False})
    assert 3 in [r["theme_id"] for r in c.get("/api/priorities").json()["items"]]


def test_feedback_detail_returns_similar_via_pgvector_and_filters_work(c, client_env):
    fid = client_env[1][0]
    d = c.get(f"/api/feedback/{fid}").json()
    assert d["theme_id"] in (1, 2, 3) and d["similar"] and all(s["feedback_id"] != fid for s in d["similar"])
    assert all(0 <= s["similarity"] <= 1.0001 for s in d["similar"])
    page = c.get("/api/feedback?theme_id=2&page_size=5").json()
    assert page["total"] == 300 and len(page["items"]) == 5 and all(i["theme_id"] == 2 for i in page["items"])
    assert c.get("/api/feedback?date_from=garbage").status_code == 400


def test_semantic_search_uses_langchain_retriever(c):
    r = c.get("/api/feedback/search?q=photo upload crash&k=5").json()
    assert len(r["results"]) == 5 and sum(x["theme_id"] == 1 for x in r["results"]) >= 4


def test_theme_correction_is_stored_and_moves_feedback(c, client_env):
    from backend.app import db
    from backend.app.models import ThemeCorrection
    fid = c.get("/api/feedback?theme_id=3&page_size=1").json()["items"][0]["id"]
    r = c.post(f"/api/feedback/{fid}/correct-theme", json={"new_theme_id": 2}).json()
    assert r == {"feedback_id": fid, "old_theme": 3, "new_theme": 2}
    d = c.get(f"/api/feedback/{fid}").json()
    assert d["theme_id"] == 2 and d["assigned_by"] == "pm" and len(d["corrections"]) == 1
    with db.session_factory()() as s:
        row = s.query(ThemeCorrection).filter_by(feedback_id=fid).one()
        assert (row.old_theme, row.new_theme) == (3, 2) and row.timestamp is not None
    assert c.post(f"/api/feedback/{fid}/correct-theme", json={"new_theme_id": 2}).status_code == 400   # no-op rejected
    assert c.post(f"/api/feedback/{fid}/correct-theme", json={"new_theme_id": 777}).status_code == 404


def test_roadmap_lifecycle(c):
    r = c.post("/api/roadmap", json={"theme_id": 1, "bucket": "now", "rationale": "Spiking + critical", "evidence_links": ["/feedback/x"]})
    assert r.status_code == 200
    item = r.json()
    assert item["bucket"] == "now" and item["priority_snapshot"] is not None and item["current_rank"] is not None
    assert c.post("/api/roadmap", json={"theme_id": 1, "bucket": "later"}).json()["id"] == item["id"]   # upsert, one item per theme
    assert c.post("/api/roadmap", json={"theme_id": 1, "bucket": "someday"}).status_code == 400
    p = c.patch(f"/api/roadmap/{item['id']}", json={"status": "planned", "notes": "talked to eng"}).json()
    assert p["status"] == "planned" and p["notes"] == "talked to eng"
    assert any(r["roadmap_bucket"] == "later" for r in c.get("/api/priorities").json()["items"] if r["theme_id"] == 1)
    assert len(c.get("/api/roadmap").json()["items"]) == 1
    assert c.delete(f"/api/roadmap/{item['id']}").status_code == 200
    assert c.get("/api/roadmap").json()["items"] == []


def test_merge_moves_feedback_and_hides_source(c):
    before = {t["id"]: t["mentions"] for t in c.get("/api/themes?kind=").json()}
    r = c.post("/api/themes/merge", json={"source_ids": [3], "target_id": 2, "label": "Merged"}).json()
    assert r["feedback_moved"] == before[3]
    after = {t["id"]: t["mentions"] for t in c.get("/api/themes?kind=").json()}
    assert 3 not in after and after[2] == before[2] + before[3]
    assert c.post("/api/themes/merge", json={"source_ids": [2], "target_id": 2}).status_code == 400


# ---------------- CSV ingestion ----------------
CSV = (
    "comment,when,stars,channel\n"
    "The photo upload keeps crashing the whole app every single time,2024-05-01,1,support\n"
    "The photo upload keeps crashing the whole app every single time,2024-05-02,1,support\n"      # duplicate text
    "ok,2024-05-03,5,support\n"                                                                     # too short
    "Please add a dark mode because the white screen hurts at night,not-a-date,4,nps\n"          # bad date kept as unknown
    "Esta aplicación es muy buena y funciona perfectamente bien,2024-05-04,5,nps\n"               # non-English
    ",2024-05-05,3,nps\n"                                                                           # empty
)


def _upload(c, content=CSV, mapping=None):
    mapping = {"text": "comment", "date": "when", "rating": "stars", "source": "channel"} if mapping is None else mapping
    import json
    return c.post("/api/feedback/upload", files={"file": ("f.csv", io.BytesIO(content.encode()), "text/csv")},
                  data={"mapping": json.dumps(mapping)})


def test_upload_preview_suggests_mapping(c):
    r = c.post("/api/feedback/upload/preview", files={"file": ("f.csv", io.BytesIO(CSV.encode()), "text/csv")}).json()
    assert r["columns"] == ["comment", "when", "stars", "channel"] and r["row_count"] == 6
    assert r["suggested_mapping"]["text"] is None or r["suggested_mapping"]["text"] == "comment"
    assert r["suggested_mapping"]["source"] == "channel" and r["suggested_mapping"]["rating"] == "stars"


def test_upload_validates_cleans_embeds_and_assigns(c):
    r = _upload(c)
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["rows_read"] == 6 and s["imported"] == 2
    assert s["dropped_empty_text"] == 1 and s["dropped_too_short_or_noisy"] == 1 and s["dropped_non_english"] == 1
    assert s["duplicates_in_file"] == 1 and s["invalid_dates"] >= 1
    assert s["assigned_to_existing_theme"] + s["uncategorized"] == 2
    runs = c.get("/api/ingestion-runs").json()
    assert runs[0]["filename"] == "f.csv" and runs[0]["column_mapping"]["text"] == "comment"
    # unknown stays unknown: no fabricated segment/product area
    hit = c.get("/api/feedback?q=dark mode because the white screen").json()["items"][0]
    assert hit["customer_segment"] is None and hit["product_area"] is None and hit["created_at"] is None and hit["source"] == "nps"
    # re-uploading the same file adds nothing
    again = _upload(c)
    assert again.status_code == 400 and "No valid new feedback" in again.json()["detail"]


@pytest.mark.parametrize("content,mapping,msg", [
    ("", {"text": "a"}, "empty"),
    ("a,b\n", {"text": "a"}, "no data"),
    ("a,b\nx y z w v u,1\n", {}, "text column must be mapped"),
    ("a,b\nx y z w v u,1\n", {"text": "nope"}, "not found"),
])
def test_upload_rejects_bad_input(c, content, mapping, msg):
    r = _upload(c, content, mapping)
    assert r.status_code == 400 and msg.lower() in r.json()["detail"].lower()
