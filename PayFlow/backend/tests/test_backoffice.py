import pytest
from django.db import connection

from backoffice.models import Settlement
from backoffice.services import reconcile, run_settlement
from ledger.models import Account
from payments.models import Payment
from tests.conftest import new_key, pay

pytestmark = pytest.mark.usefixtures("no_fraud")


def test_clean_ledger_reconciles(api, tenant, world):
    customer, merchant = world
    pay(api, customer, merchant, 1_000)
    run = reconcile(tenant)
    assert run.status == "ok" and run.mismatch_count == 0
    assert run.accounts_checked == 4  # customer, merchant, external, holds


def test_reconciliation_detects_a_tampered_balance(api, tenant, world):
    customer, merchant = world
    pay(api, customer, merchant, 1_000)
    with connection.cursor() as cursor:  # someone "fixes" a balance behind the ledger's back
        cursor.execute("UPDATE ledger_account SET cached_balance = cached_balance + 5 WHERE id = %s", [merchant.id])
    run = reconcile(tenant)
    assert run.status == "mismatch"
    finding = run.findings[0]
    assert finding["type"] == "balance_mismatch" and finding["account"] == str(merchant.id)
    assert finding["cached"] - finding["derived"] == 5


def test_reconciliation_endpoint_and_scoping(api, world):
    customer, merchant = world
    pay(api, customer, merchant, 1_000)
    response = api.post("/api/v1/reconciliation/runs")
    assert response.status_code == 201 and response.json()["status"] == "ok"
    assert api.get("/api/v1/reconciliation/runs").json()["count"] == 1


def test_settlement_pays_out_net_of_refunds_once(api, tenant, world):
    customer, merchant = world
    first = pay(api, customer, merchant, 4_000).json()
    pay(api, customer, merchant, 6_000)
    api.post(
        "/api/v1/refunds", {"payment_id": first["id"], "amount": 1_500}, format="json", HTTP_IDEMPOTENCY_KEY=new_key()
    )

    settlements = run_settlement(tenant, delay_seconds=0)
    assert len(settlements) == 1
    assert settlements[0].amount == 8_500 and settlements[0].payment_count == 2
    merchant.refresh_from_db()
    assert merchant.cached_balance == 0
    assert Payment.objects.filter(settled_at__isnull=True).count() == 0
    assert run_settlement(tenant, delay_seconds=0) == []  # nothing left to settle
    assert reconcile(tenant).status == "ok"


def test_settlement_respects_the_delay(api, tenant, world):
    customer, merchant = world
    pay(api, customer, merchant, 4_000)
    assert run_settlement(tenant, delay_seconds=3_600) == []
    response = api.post("/api/v1/settlements/run", {"delay_seconds": 0}, format="json")
    assert response.status_code == 201 and response.json()[0]["amount"] == 4_000
    assert api.get("/api/v1/settlements").json()["count"] == 1
    assert Settlement.objects.get().account_id == merchant.id


def test_stats_overview_and_me(api, world):
    customer, merchant = world
    pay(api, customer, merchant, 1_000)
    pay(api, customer, merchant, 10**9)  # fails: insufficient funds
    data = api.get("/api/v1/stats/overview").json()
    assert data["payments"]["total"] == 2
    assert data["payments"]["by_status"] == {"captured": 1, "failed": 1}
    assert data["payments"]["captured_volume"] == 1_000
    assert len(data["series"]) == 31 and sum(p["count"] for p in data["series"]) == 2
    assert api.get("/api/v1/me").json()["name"] == "Acme Marketplace"
    assert Account.objects.filter(client=customer.client).count() == data["accounts"]


def test_health_openapi_and_metrics(client, api, world):
    assert client.get("/health/").json() == {"status": "ok", "database": "up"}
    schema = api.get("/api/schema/")
    assert schema.status_code == 200
    metrics = client.get("/metrics").content.decode()
    assert "payflow_payments" in metrics and "django_http_requests_total" in metrics
