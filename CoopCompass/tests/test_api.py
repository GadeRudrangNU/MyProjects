from tests.conftest import SAMPLE_JD, SAMPLE_RESUME


def _add_job(client, title="Data Analyst Co-op", company="Example Analytics Co."):
    r = client.post("/api/jobs", json={"company": company, "title": title, "description": SAMPLE_JD})
    assert r.status_code == 200, r.text
    return r.json()


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "ok" and d["ai_provider"] == "local" and d["ai_available"] is False
    assert d["embedding_backend"] == "tfidf"


def test_profile_roundtrip_and_first_save_event(client, profile_payload):
    assert client.get("/api/profile").json()["exists"] is False
    r = client.post("/api/profile", json=profile_payload)
    assert r.status_code == 200
    p = r.json()
    assert p["exists"] and "Python" in p["skills"]
    assert abs(sum(p["match_weights"].values()) - 100) < 0.5
    assert client.get("/api/profile").json()["name"] == "Jane Student"


def test_resume_upload_returns_draft_without_saving(client):
    r = client.post("/api/resume/upload", files={"file": ("resume.txt", SAMPLE_RESUME.encode(), "text/plain")})
    assert r.status_code == 200
    d = r.json()
    assert d["draft"]["skills"] and d["draft"]["evidence_items"]
    assert client.get("/api/profile").json()["exists"] is False
    assert client.post("/api/resume/upload", files={"file": ("x.exe", b"abc", "application/octet-stream")}).status_code == 415


def test_job_create_dedupes_and_parses(client):
    a = _add_job(client)
    b = _add_job(client)
    assert a["id"] == b["id"]
    assert "Python" in a["required_skills"] and "AWS" in a["preferred_skills"]
    assert a["match_score"] is None
    assert a["work_authorization_notes"]


def test_match_requires_profile_then_works(client, profile_payload):
    job = _add_job(client)
    r = client.post(f"/api/jobs/{job['id']}/analyze")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "profile_required"
    client.post("/api/profile", json=profile_payload)
    m = client.post(f"/api/jobs/{job['id']}/analyze").json()
    assert 0 <= m["overall"] <= 100
    assert abs(m["overall"] - sum(b["points"] for b in m["breakdown"])) < 0.11
    assert {s["skill"] for s in m["strong"]} >= {"Python", "SQL"}
    assert any(g["requirement"] == "A/B Testing" and g["message"] == "No evidence found in current resume." for g in m["gaps"])
    py = next(s for s in m["strong"] if s["skill"] == "Python")
    assert py["evidence"] and "Python" in py["evidence"][0]["text"]
    skewed = client.get(f"/api/jobs/{job['id']}/match", params={"weights": "skills:100,experience:0,role:0,education:0,location:0,preferences:0"}).json()
    assert skewed["overall"] != m["overall"]
    jobs = client.get("/api/jobs").json()
    assert jobs[0]["match_score"] == m["overall"]


def test_gap_analysis_separates_present_weak_gap(client, profile_payload):
    job = _add_job(client)
    client.post("/api/profile", json=profile_payload)
    g = client.get(f"/api/jobs/{job['id']}/gap-analysis").json()
    assert "Python" in {x["requirement"] for x in g["present"]}
    assert "A/B Testing" in {x["requirement"] for x in g["gaps"]}
    assert all(x["message"] == "No evidence found in current resume." for x in g["gaps"])


def test_application_lifecycle_and_analytics_insufficient(client, profile_payload):
    job = _add_job(client)
    client.post("/api/profile", json=profile_payload)
    client.patch(f"/api/jobs/{job['id']}", json={"user_state": "saved"})
    apps = client.get("/api/applications").json()
    assert len(apps) == 1 and apps[0]["status"] == "Saved"
    a = client.post("/api/applications", json={"job_id": job["id"], "status": "Preparing"}).json()
    assert a["status"] == "Preparing" and len(client.get("/api/applications").json()) == 1
    a = client.patch(f"/api/applications/{a['id']}", json={"status": "Applied", "baseline_minutes": 120}).json()
    assert a["date_applied"] and [h["to_status"] for h in a["history"]][-1] == "Applied"
    client.post("/api/time-records", json={"job_id": job["id"], "kind": "application_preparation", "seconds": 600})
    an = client.get("/api/analytics").json()
    assert an["sufficient_data"] is False
    assert an["conversion"]["interview_rate"]["rate"] is None
    stages = {s["stage"]: s["count"] for s in an["funnel"]}
    assert stages["job_added"] == 1 and stages["application_marked_applied"] == 1 and stages["interview_received"] == 0
    pm = client.get("/api/product-metrics").json()
    assert pm["observations_with_baseline"] == 1 and pm["claimable"] is False
    assert pm["median_baseline_minutes"] == 120 and pm["median_assisted_minutes"] == 10
    assert pm["median_time_reduction_pct"] == 91.7


def test_invalid_inputs(client):
    assert client.post("/api/events", json={"name": "not_an_event"}).status_code == 422
    assert client.post("/api/applications", json={"job_id": 999}).status_code == 404
    assert client.post("/api/time-records", json={"kind": "job_analysis", "seconds": -5}).status_code == 422
    assert client.delete("/api/data").status_code == 400


def test_delete_data(client, profile_payload):
    job = _add_job(client)
    client.post("/api/profile", json=profile_payload)
    r = client.delete("/api/data", params={"confirm": "true"}).json()
    assert r["deleted"]["jobs"] == 1 and r["deleted"]["profile"] == 1
    assert client.get("/api/profile").json()["exists"] is False
    assert client.get("/api/jobs").json() == []


def test_tailor_and_draft_local_fallback(client, profile_payload):
    job = _add_job(client)
    client.post("/api/profile", json=profile_payload)
    t = client.post(f"/api/jobs/{job['id']}/tailor").json()
    assert t["provider"] == "local" and t["suggestions"]
    assert all(s["suggested"] is None and s["source_evidence"]["text"] for s in t["suggestions"])
    s = client.patch(f"/api/generations/{t['generation_id']}/suggestions/0", json={"status": "accepted"}).json()
    assert s["status"] == "accepted"
    d = client.post(f"/api/jobs/{job['id']}/draft", json={"kind": "cover_letter"}).json()
    assert d["is_template"] and "TEMPLATE DRAFT" in d["disclaimer"]
    assert len(client.get(f"/api/jobs/{job['id']}/drafts").json()) == 1
    client.post(f"/api/jobs/{job['id']}/draft", json={"kind": "cover_letter"})
    assert len(client.get(f"/api/jobs/{job['id']}/drafts").json()) == 1
