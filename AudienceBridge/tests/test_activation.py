import copy

from audiencebridge import privacy
from audiencebridge.activation import campaigns, data_manager
from audiencebridge.config import ROOT, load_client_config

CFG = load_client_config(ROOT / "config" / "clients" / "gmerch_store.yaml")


def row(i, with_address=True):
    return {
        "hashed_email": privacy.hash_email(f"user{i}@example.com"),
        "hashed_phone": privacy.hash_phone(f"617555{i:04d}"),
        "hashed_first_name": privacy.sha256_hex("ada") if with_address else None,
        "hashed_last_name": privacy.sha256_hex("lovelace") if with_address else None,
        "region_code": "US",
        "postal_code": "02115",
    }


def test_member_includes_address_only_when_complete():
    full = data_manager.member_from_row(row(1))
    kinds = [next(iter(i)) for i in full["userData"]["userIdentifiers"]]
    assert kinds == ["emailAddress", "phoneNumber", "address"]
    partial = data_manager.member_from_row(row(1, with_address=False))
    assert [next(iter(i)) for i in partial["userData"]["userIdentifiers"]] == ["emailAddress", "phoneNumber"]


def test_member_without_identifiers_is_dropped():
    empty = {"hashed_email": None, "hashed_phone": float("nan"), "region_code": "US", "postal_code": "02115"}
    assert data_manager.member_from_row(empty) is None


def test_requests_are_chunked_and_valid():
    rows = [row(i) for i in range(25)]
    requests = data_manager.build_requests("seg", rows, chunk_size=10)
    assert [len(r["audienceMembers"]) for r in requests] == [10, 10, 5]
    assert all(data_manager.validate_request(r) == [] for r in requests)
    assert requests[0]["destinations"][0]["productDestinationId"] == "DRY_RUN_LIST_seg"
    assert requests[0]["validateOnly"] is False


def test_validation_catches_unhashed_identifiers_and_missing_consent():
    request = data_manager.build_requests("seg", [row(1)])[0]
    bad = copy.deepcopy(request)
    bad["audienceMembers"][0]["userData"]["userIdentifiers"][0] = {"emailAddress": "plain@example.com"}
    bad["consent"]["adPersonalization"] = "CONSENT_DENIED"
    errors = data_manager.validate_request(bad)
    assert any("emailAddress is not a SHA-256" in e for e in errors)
    assert any("consent" in e for e in errors)


def test_blank_account_env_falls_back_to_placeholder(monkeypatch):
    monkeypatch.setenv("GOOGLE_ADS_CUSTOMER_ID", "")
    monkeypatch.setenv("GOOGLE_ADS_LOGIN_CUSTOMER_ID", "")
    destination = data_manager.build_destination("seg", None)
    assert destination["operatingAccount"]["accountId"] == "DRY_RUN_ACCOUNT"
    assert "loginAccount" not in destination


def test_validation_flags_empty_request():
    assert "no audience members" in data_manager.validate_request({"destinations": [{}], "audienceMembers": []})


def test_payload_never_contains_raw_identifiers():
    import json

    text = json.dumps(data_manager.build_requests("seg", [row(1)]))
    assert "@" not in text and "example.com" not in text


def test_campaign_plan_follows_objectives():
    plan = campaigns.plan_campaigns(CFG)
    assert plan["status"] == "PAUSED"
    groups = {g["segment"]: g for g in plan["ad_groups"]}
    assert "recent_purchasers_exclusion" not in groups
    assert [e["segment"] for e in plan["exclusions"]] == ["recent_purchasers_exclusion"]
    assert groups["cart_abandoners_7d"]["cpc_bid_micros"] > groups["apparel_browsers"]["cpc_bid_micros"]
    assert plan["daily_budget_micros"] == 5_000_000
