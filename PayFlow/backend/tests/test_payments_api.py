import pytest

from ledger.models import Account, Entry
from payments.models import Payment
from tests.conftest import api_for, new_key, pay

pytestmark = pytest.mark.usefixtures("no_fraud")


def balance(api, account):
    return api.get(f"/api/v1/accounts/{account.id}/balance").json()["balance"]


def test_authentication_is_required(db, world):
    from rest_framework.test import APIClient

    assert APIClient().get("/api/v1/accounts").status_code == 401
    bad = APIClient()
    bad.credentials(HTTP_AUTHORIZATION="Bearer nope")
    assert bad.get("/api/v1/accounts").status_code == 401


def test_payment_is_captured_and_moves_money(api, world):
    customer, merchant = world
    response = pay(api, customer, merchant, 2_500)
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "captured"
    assert balance(api, customer) == 97_500
    assert balance(api, merchant) == 2_500


def test_insufficient_funds_fails_with_402_and_moves_nothing(api, world):
    customer, merchant = world
    response = pay(api, customer, merchant, 100_001)
    assert response.status_code == 402
    assert response.json()["failure_reason"] == "insufficient_funds"
    assert balance(api, customer) == 100_000
    assert balance(api, merchant) == 0


def test_authorize_then_capture_holds_funds_in_between(api, world):
    customer, merchant = world
    body = pay(api, customer, merchant, 4_000, capture=False).json()
    assert body["status"] == "authorized"
    assert balance(api, customer) == 96_000
    assert balance(api, merchant) == 0
    holds = Account.objects.get(client=customer.client, kind="holds")
    assert balance(api, holds) == 4_000

    captured = api.post(f"/api/v1/payments/{body['id']}/capture", format="json", HTTP_IDEMPOTENCY_KEY=new_key())
    assert captured.status_code == 200 and captured.json()["status"] == "captured"
    assert balance(api, holds) == 0
    assert balance(api, merchant) == 4_000


def test_void_releases_the_hold(api, world):
    customer, merchant = world
    body = pay(api, customer, merchant, 4_000, capture=False).json()
    voided = api.post(f"/api/v1/payments/{body['id']}/void", format="json", HTTP_IDEMPOTENCY_KEY=new_key())
    assert voided.status_code == 200
    assert voided.json()["status"] == "failed" and voided.json()["failure_reason"] == "voided"
    assert balance(api, customer) == 100_000


@pytest.mark.parametrize("first,second", [("capture", "capture"), ("void", "capture"), ("capture", "void")])
def test_invalid_transitions_are_blocked(api, world, first, second):
    customer, merchant = world
    payment = pay(api, customer, merchant, 1_000, capture=False).json()
    assert (
        api.post(f"/api/v1/payments/{payment['id']}/{first}", format="json", HTTP_IDEMPOTENCY_KEY=new_key()).status_code
        == 200
    )
    again = api.post(f"/api/v1/payments/{payment['id']}/{second}", format="json", HTTP_IDEMPOTENCY_KEY=new_key())
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "invalid_state_transition"


def test_full_refund_marks_refunded(api, world):
    customer, merchant = world
    payment = pay(api, customer, merchant, 5_000).json()
    response = api.post("/api/v1/refunds", {"payment_id": payment["id"]}, format="json", HTTP_IDEMPOTENCY_KEY=new_key())
    assert response.status_code == 201 and response.json()["amount"] == 5_000
    assert api.get(f"/api/v1/payments/{payment['id']}").json()["status"] == "refunded"
    assert balance(api, customer) == 100_000
    assert balance(api, merchant) == 0


def test_partial_refunds_cannot_exceed_the_payment(api, world):
    customer, merchant = world
    payment = pay(api, customer, merchant, 5_000).json()

    def refund(amount):
        return api.post(
            "/api/v1/refunds",
            {"payment_id": payment["id"], "amount": amount},
            format="json",
            HTTP_IDEMPOTENCY_KEY=new_key(),
        )

    assert refund(3_000).status_code == 201
    too_much = refund(2_001)
    assert too_much.status_code == 422 and too_much.json()["error"]["code"] == "refund_exceeds_payment"
    assert api.get(f"/api/v1/payments/{payment['id']}").json()["status"] == "captured"
    assert refund(2_000).status_code == 201
    assert api.get(f"/api/v1/payments/{payment['id']}").json()["status"] == "refunded"
    assert refund(1).status_code == 409  # nothing left, and no longer captured


def test_refund_fails_when_merchant_cannot_cover_it(api, world):
    customer, merchant = world
    payment = pay(api, customer, merchant, 5_000).json()
    from django.db import transaction

    from ledger.services import post_transfer

    external = Account.objects.get(client=customer.client, kind="external")
    with transaction.atomic():  # the merchant withdraws everything first
        post_transfer(client=customer.client, source=merchant, destination=external, amount=5_000, kind="payout")
    response = api.post("/api/v1/refunds", {"payment_id": payment["id"]}, format="json", HTTP_IDEMPOTENCY_KEY=new_key())
    assert response.status_code == 402
    assert response.json()["error"]["code"] == "merchant_insufficient_funds"


# --- idempotency -----------------------------------------------------------------


def test_same_key_and_body_is_processed_exactly_once(api, world):
    customer, merchant = world
    key = new_key()
    first = pay(api, customer, merchant, 1_500, key=key)
    second = pay(api, customer, merchant, 1_500, key=key)
    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()
    assert second["Idempotent-Replayed"] == "true"
    assert Payment.objects.count() == 1
    assert balance(api, customer) == 98_500


def test_failed_payments_are_replayed_too(api, world):
    customer, merchant = world
    key = new_key()
    assert pay(api, customer, merchant, 999_999, key=key).status_code == 402
    assert pay(api, customer, merchant, 999_999, key=key).status_code == 402
    assert Payment.objects.count() == 1


def test_key_reuse_with_a_different_body_is_rejected(api, world):
    customer, merchant = world
    key = new_key()
    assert pay(api, customer, merchant, 1_500, key=key).status_code == 201
    clash = pay(api, customer, merchant, 1_501, key=key)
    assert clash.status_code == 422
    assert clash.json()["error"]["code"] == "idempotency_key_reuse"
    assert Payment.objects.count() == 1


def test_missing_key_is_a_validation_error(api, world):
    customer, merchant = world
    response = api.post(
        "/api/v1/payments", {"payer_id": str(customer.id), "payee_id": str(merchant.id), "amount": 10}, format="json"
    )
    assert response.status_code == 400
    assert Payment.objects.count() == 0


def test_a_failure_rolls_everything_back_and_does_not_burn_the_key(api, world):
    customer, merchant = world
    key = new_key()
    payment = pay(api, customer, merchant, 1_000, key=new_key()).json()
    # Refund of an unknown payment raises inside the idempotent block.
    bad = api.post(
        "/api/v1/refunds",
        {"payment_id": "00000000-0000-0000-0000-000000000000"},
        format="json",
        HTTP_IDEMPOTENCY_KEY=key,
    )
    assert bad.status_code == 404
    ok = api.post("/api/v1/refunds", {"payment_id": payment["id"]}, format="json", HTTP_IDEMPOTENCY_KEY=key)
    assert ok.status_code == 201  # the failed attempt rolled back, so the key was never consumed


def test_deposit_is_idempotent(api, tenant):
    account = api.post("/api/v1/accounts", {"name": "Dana", "kind": "customer"}, format="json").json()
    key = new_key()
    for _ in range(3):
        response = api.post(
            f"/api/v1/accounts/{account['id']}/deposit", {"amount": 700}, format="json", HTTP_IDEMPOTENCY_KEY=key
        )
        assert response.status_code == 201
    assert balance(api, Account(id=account["id"])) == 700


# --- tenancy and validation ---------------------------------------------------------


def test_tenants_cannot_see_each_others_data(api, world):
    from core.models import ApiClient

    customer, merchant = world
    pay(api, customer, merchant, 100)
    other, key = ApiClient.create_with_key("Other Co")
    other.raw_key = key
    rival = api_for(other)
    assert rival.get("/api/v1/payments").json()["count"] == 0
    assert rival.get(f"/api/v1/accounts/{customer.id}/balance").status_code == 404
    response = pay(rival, customer, merchant, 100)
    assert response.status_code == 400  # unknown accounts for this tenant


def test_validation(api, world):
    customer, merchant = world
    assert pay(api, customer, merchant, 0).status_code == 400
    assert pay(api, customer, merchant, -5).status_code == 400
    assert pay(api, customer, merchant, 10, risk_signals=[1, 2, 3]).status_code == 400
    swapped = pay(api, merchant, customer, 10)
    assert swapped.status_code == 422 and swapped.json()["error"]["code"] == "invalid_accounts"


def test_transactions_endpoint_lists_balanced_ledger_entries(api, world):
    customer, merchant = world
    pay(api, customer, merchant, 2_000)
    data = api.get(f"/api/v1/transactions?account={merchant.id}").json()
    assert data["count"] == 1  # only the capture touches the merchant's account
    assert data["results"][0]["kind"] == "capture"
    assert all(sum(e["amount"] for e in t["entries"]) == 0 for t in api.get("/api/v1/transactions").json()["results"])


def test_ledger_always_balances_after_activity(api, world):
    customer, merchant = world
    for amount in (100, 250, 999):
        pay(api, customer, merchant, amount)
    total = sum(Entry.objects.values_list("amount", flat=True))
    assert total == 0
