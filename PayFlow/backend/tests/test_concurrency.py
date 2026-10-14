"""Hundreds of simultaneous requests against the same accounts, each on its own database
connection. These are the tests that show the row locking and idempotency actually work."""

from concurrent.futures import ThreadPoolExecutor

import pytest
from django.db import connection
from django.db.models import Sum

from backoffice.services import reconcile
from ledger.models import Account, Entry
from ledger.services import deposit
from payments.models import Payment
from tests.conftest import api_for, new_key, pay

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.usefixtures("no_fraud")]

THREADS = 32


def run_parallel(jobs, workers=THREADS):
    def wrapped(job):
        try:
            return job()
        finally:
            connection.close()  # each worker thread owns its own connection

    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(wrapped, jobs))


@pytest.fixture
def funded(tenant):
    customer = Account.objects.create(client=tenant, name="Casey", kind=Account.Kind.CUSTOMER)
    merchant = Account.objects.create(client=tenant, name="Shop", kind=Account.Kind.MERCHANT)
    deposit(client=tenant, account=customer, amount=10_000)
    return customer, merchant


def test_concurrent_payments_never_overdraw_an_account(tenant, funded):
    customer, merchant = funded
    api = api_for(tenant)
    # 250 simultaneous payments of 100 against a balance that covers exactly 100 of them.
    responses = run_parallel([lambda: pay(api, customer, merchant, 100) for _ in range(250)])

    codes = [r.status_code for r in responses]
    assert codes.count(201) == 100
    assert codes.count(402) == 150
    customer.refresh_from_db()
    merchant.refresh_from_db()
    assert customer.cached_balance == 0
    assert merchant.cached_balance == 10_000
    assert Entry.objects.filter(account=customer).aggregate(s=Sum("amount"))["s"] == 0
    assert Entry.objects.aggregate(s=Sum("amount"))["s"] == 0  # the whole ledger still sums to zero
    assert reconcile(tenant).status == "ok"


def test_concurrent_duplicate_requests_with_one_key_charge_once(tenant, funded):
    customer, merchant = funded
    api = api_for(tenant)
    key = new_key()
    responses = run_parallel([lambda: pay(api, customer, merchant, 1_000, key=key) for _ in range(40)])

    assert {r.status_code for r in responses} == {201}
    assert len({r.json()["id"] for r in responses}) == 1
    assert Payment.objects.count() == 1
    customer.refresh_from_db()
    assert customer.cached_balance == 9_000
    replays = [r for r in responses if r.headers.get("Idempotent-Replayed") == "true"]
    assert len(replays) == 39


def test_concurrent_refunds_cannot_exceed_the_payment(tenant, funded):
    customer, merchant = funded
    api = api_for(tenant)
    payment = pay(api, customer, merchant, 5_000).json()

    def refund():
        return api.post(
            "/api/v1/refunds",
            {"payment_id": payment["id"], "amount": 1_000},
            format="json",
            HTTP_IDEMPOTENCY_KEY=new_key(),
        )

    responses = run_parallel([refund for _ in range(20)])
    assert sorted(r.status_code for r in responses).count(201) == 5
    stored = Payment.objects.get(id=payment["id"])
    assert stored.refunded_amount == 5_000 and stored.status == "refunded"
    merchant.refresh_from_db()
    assert merchant.cached_balance == 0
    assert reconcile(tenant).status == "ok"


def test_opposing_transfers_between_two_accounts_do_not_deadlock(tenant):
    """A pays B while B pays A, over and over: row locks are taken in a fixed order."""
    a = Account.objects.create(client=tenant, name="A", kind=Account.Kind.CUSTOMER)
    b = Account.objects.create(client=tenant, name="B", kind=Account.Kind.CUSTOMER)
    deposit(client=tenant, account=a, amount=50_000)
    deposit(client=tenant, account=b, amount=50_000)

    from django.db import transaction

    from ledger.services import InsufficientFunds, post_transfer

    def transfer(src, dst):
        def job():
            try:
                with transaction.atomic():
                    post_transfer(client=tenant, source=src, destination=dst, amount=7, kind="capture")
            except InsufficientFunds:
                pass

        return job

    run_parallel([transfer(a, b) if i % 2 else transfer(b, a) for i in range(200)])
    a.refresh_from_db()
    b.refresh_from_db()
    assert a.cached_balance + b.cached_balance == 100_000
    assert reconcile(tenant).status == "ok"


def test_mixed_concurrent_traffic_never_deadlocks(tenant, monkeypatch):
    """Payments, authorize-then-capture, refunds, voids and deposits all hitting the same few
    accounts at once. Regression test for two lock-ordering bugs the traffic simulator found:
    foreign-key checks conflicting with FOR UPDATE, and the tenant row being locked along with the
    payment. The deadlock retry in the idempotency layer is switched off so a deadlock fails loudly."""
    monkeypatch.setattr("core.idempotency.MAX_ATTEMPTS", 1)
    api = api_for(tenant)
    customers = [Account.objects.create(client=tenant, name=f"c{i}", kind=Account.Kind.CUSTOMER) for i in range(6)]
    merchants = [Account.objects.create(client=tenant, name=f"m{i}", kind=Account.Kind.MERCHANT) for i in range(2)]
    for customer in customers:
        deposit(client=tenant, account=customer, amount=2_000_000)

    def action(i):
        def job():
            customer, merchant = customers[i % len(customers)], merchants[i % len(merchants)]
            kind = i % 5
            if kind == 0:
                return pay(api, customer, merchant, 1_000 + i).status_code
            created = pay(api, customer, merchant, 2_000 + i, capture=False)
            if created.status_code != 201:
                return created.status_code
            payment_id = created.json()["id"]
            if kind == 1:
                step = api.post(f"/api/v1/payments/{payment_id}/capture", format="json", HTTP_IDEMPOTENCY_KEY=new_key())
            elif kind == 2:
                step = api.post(f"/api/v1/payments/{payment_id}/void", format="json", HTTP_IDEMPOTENCY_KEY=new_key())
            elif kind == 3:
                api.post(f"/api/v1/payments/{payment_id}/capture", format="json", HTTP_IDEMPOTENCY_KEY=new_key())
                step = api.post(
                    "/api/v1/refunds",
                    {"payment_id": payment_id, "amount": 500},
                    format="json",
                    HTTP_IDEMPOTENCY_KEY=new_key(),
                )
            else:
                step = api.post(
                    f"/api/v1/accounts/{customer.id}/deposit",
                    {"amount": 700},
                    format="json",
                    HTTP_IDEMPOTENCY_KEY=new_key(),
                )
            return step.status_code

        return job

    codes = run_parallel([action(i) for i in range(150)], workers=24)
    assert max(codes) < 500, f"server errors under concurrent load: {sorted(set(codes))}"
    assert reconcile(tenant).status == "ok"
