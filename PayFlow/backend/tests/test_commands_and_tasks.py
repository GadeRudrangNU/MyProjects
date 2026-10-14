from io import StringIO

import pytest
from django.core.management import call_command

from backoffice.models import ReconciliationRun
from backoffice.tasks import run_reconciliation, run_settlement
from core.models import ApiClient, hash_api_key
from ledger.models import Account
from tests.conftest import pay

pytestmark = pytest.mark.usefixtures("no_fraud")


def test_create_client_prints_a_working_key_and_stores_only_its_hash(db):
    out = StringIO()
    call_command("create_client", "Command Co", stdout=out)
    values = dict(line.split("=", 1) for line in out.getvalue().splitlines())
    client = ApiClient.objects.get(id=values["client_id"])
    assert client.key_hash == hash_api_key(values["api_key"])
    assert values["api_key"] not in (client.key_hash, client.key_prefix)
    assert Account.objects.filter(client=client).count() == 2  # external + holds system accounts


def test_seed_demo_creates_funded_accounts(db):
    out = StringIO()
    call_command("seed_demo", "--no-frontend-env", stdout=out)
    client = ApiClient.objects.get(name="Demo Marketplace")
    assert Account.objects.filter(client=client, kind="customer", cached_balance=250_000).count() == 3
    assert "api_key=pf_test_" in out.getvalue()


def test_nightly_tasks_cover_every_active_client(api, world, tenant):
    customer, merchant = world
    pay(api, customer, merchant, 1_000)
    inactive, _ = ApiClient.create_with_key("Dormant")
    ApiClient.objects.filter(id=inactive.id).update(is_active=False)

    assert run_reconciliation() == "1 clients reconciled, 0 with mismatches"
    assert ReconciliationRun.objects.filter(client=tenant).count() == 1
    assert run_settlement() == 0  # default delay is 24h, so nothing is due yet


def test_inactive_client_key_is_rejected(api, tenant):
    ApiClient.objects.filter(id=tenant.id).update(is_active=False)
    assert api.get("/api/v1/me").status_code == 401
