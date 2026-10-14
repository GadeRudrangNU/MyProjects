import copy
import json
import random
from datetime import timedelta

import pytest
from django.db import transaction
from django.utils import timezone

from ledger.models import Account
from ledger.services import deposit
from tests.conftest import new_key, pay
from webhooks import services
from webhooks.models import WebhookDelivery
from webhooks.signing import SIGNATURE_HEADER, compute_signature, signature_header, verify_signature
from webhooks.tasks import deliver_webhook, dispatch_due_deliveries

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def hooked(tenant, no_fraud):
    tenant.webhook_url = "https://merchant.example/hooks"
    tenant.save()
    customer = Account.objects.create(client=tenant, name="C", kind=Account.Kind.CUSTOMER)
    merchant = Account.objects.create(client=tenant, name="M", kind=Account.Kind.MERCHANT)
    deposit(client=tenant, account=customer, amount=100_000)
    return customer, merchant


@pytest.fixture
def receiver(monkeypatch):
    """Stand-in for the merchant's server. Set `.status` to simulate outages."""

    class Receiver:
        status = 200
        calls: list = []

    r = Receiver()
    r.calls = []

    def fake_post(url, body, headers, timeout):
        r.calls.append({"url": url, "body": body, "headers": headers})
        if isinstance(r.status, Exception):
            raise r.status
        return r.status

    monkeypatch.setattr(services, "post", fake_post)
    return r


def test_signature_roundtrip_and_tamper_detection():
    body = b'{"hello":"world"}'
    header = signature_header("whsec_x", body, timestamp=1_700_000_000)
    assert verify_signature("whsec_x", header, body, now=1_700_000_100)
    assert not verify_signature("whsec_x", header, body + b" ", now=1_700_000_100)
    assert not verify_signature("whsec_other", header, body, now=1_700_000_100)
    assert not verify_signature("whsec_x", header, body, now=1_700_009_999)  # replayed too late
    assert not verify_signature("whsec_x", "garbage", body)
    assert header.split(",")[1] == "v1=" + compute_signature("whsec_x", 1_700_000_000, body)


def test_payment_events_are_delivered_signed(tenant, hooked, receiver, api):
    customer, merchant = hooked
    assert pay(api, customer, merchant, 2_000).status_code == 201
    assert [d.event_type for d in WebhookDelivery.objects.order_by("created_at")] == [
        "payment.authorized",
        "payment.captured",
    ]
    assert all(d.status == "delivered" for d in WebhookDelivery.objects.all())
    call = receiver.calls[-1]
    assert verify_signature(tenant.webhook_secret, call["headers"][SIGNATURE_HEADER], call["body"])
    event = json.loads(call["body"])
    assert event["type"] == "payment.captured" and event["data"]["amount"] == 2_000


def test_failures_back_off_exponentially_then_die(tenant, hooked, receiver, settings):
    cfg = copy.deepcopy(settings.PAYFLOW)
    cfg["WEBHOOK_MAX_ATTEMPTS"] = 4
    cfg["WEBHOOK_BACKOFF_BASE_SECONDS"] = 10
    settings.PAYFLOW = cfg
    receiver.status = 503
    delivery = services.emit(tenant, "payment.failed", {"id": "p1"})
    gaps = []
    for _ in range(4):
        deliver_webhook(str(delivery.id))
        delivery.refresh_from_db()
        if delivery.status == "pending":
            gaps.append((delivery.next_attempt_at - timezone.now()).total_seconds())
            WebhookDelivery.objects.filter(id=delivery.id).update(next_attempt_at=timezone.now())
    assert delivery.status == "dead" and delivery.attempts == 4
    assert delivery.last_status_code == 503 and delivery.last_error == "HTTP 503"
    # 10s, 20s, 40s with +/-20% jitter
    for gap, expected in zip(gaps, (10, 20, 40), strict=True):
        assert expected * 0.75 < gap < expected * 1.25


def test_backoff_doubles_and_is_capped(settings):
    rng = random.Random(1)
    base = settings.PAYFLOW["WEBHOOK_BACKOFF_BASE_SECONDS"]
    values = [services.backoff_seconds(n, rng) for n in range(1, 6)]
    assert all(b > a for a, b in zip(values, values[1:], strict=False))
    assert services.backoff_seconds(30) <= settings.PAYFLOW["WEBHOOK_BACKOFF_MAX_SECONDS"] * 1.2
    assert values[0] <= base * 1.2


def test_network_errors_count_as_failures_and_sweeper_retries(tenant, hooked, receiver):
    receiver.status = ConnectionError("refused")
    delivery = services.emit(tenant, "payment.failed", {"id": "p1"})
    deliver_webhook(str(delivery.id))
    delivery.refresh_from_db()
    assert delivery.status == "pending" and "ConnectionError" in delivery.last_error

    assert dispatch_due_deliveries() == 0  # not due yet
    receiver.status = 200
    WebhookDelivery.objects.filter(id=delivery.id).update(next_attempt_at=timezone.now() - timedelta(seconds=1))
    assert dispatch_due_deliveries() == 1  # the sweeper re-enqueues it (eager mode runs it inline)
    delivery.refresh_from_db()
    assert delivery.status == "delivered" and delivery.attempts == 2


def test_an_attempt_in_flight_is_not_duplicated(tenant, hooked, receiver):
    receiver.status = 503  # the first attempt (made at commit) fails and schedules a retry
    delivery = services.emit(tenant, "payment.failed", {"id": "p1"})
    receiver.calls.clear()
    WebhookDelivery.objects.filter(id=delivery.id).update(next_attempt_at=timezone.now() + timedelta(seconds=30))
    assert deliver_webhook(str(delivery.id)) == "skipped"
    assert receiver.calls == []


def test_event_is_never_recorded_for_a_rolled_back_change(tenant, hooked, receiver):
    with pytest.raises(RuntimeError), transaction.atomic():
        services.emit(tenant, "payment.captured", {"id": "p1"})
        raise RuntimeError("payment transaction failed")
    assert WebhookDelivery.objects.count() == 0 and receiver.calls == []


def test_clients_without_an_endpoint_get_no_events(tenant, no_fraud, api):
    customer = Account.objects.create(client=tenant, name="C", kind=Account.Kind.CUSTOMER)
    merchant = Account.objects.create(client=tenant, name="M", kind=Account.Kind.MERCHANT)
    deposit(client=tenant, account=customer, amount=1_000)
    pay(api, customer, merchant, 100)
    assert WebhookDelivery.objects.count() == 0


def test_endpoint_configuration_blocks_private_hosts_when_not_allowed(api, settings):
    cfg = copy.deepcopy(settings.PAYFLOW)
    cfg["WEBHOOK_ALLOW_PRIVATE_HOSTS"] = False
    settings.PAYFLOW = cfg
    assert api.put("/api/v1/webhooks/endpoint", {"url": "http://127.0.0.1:9/hook"}, format="json").status_code == 400
    assert api.put("/api/v1/webhooks/endpoint", {"url": "ftp://example.com/x"}, format="json").status_code == 400
    settings.PAYFLOW = {**cfg, "WEBHOOK_ALLOW_PRIVATE_HOSTS": True}
    ok = api.put("/api/v1/webhooks/endpoint", {"url": "http://127.0.0.1:9/hook"}, format="json")
    assert ok.status_code == 200 and ok.json()["secret"].startswith("whsec_")


def test_manual_retry_revives_a_dead_delivery(tenant, hooked, receiver, api):
    delivery = services.emit(tenant, "payment.failed", {"id": "p1"})
    WebhookDelivery.objects.filter(id=delivery.id).update(status="dead", attempts=8, next_attempt_at=None)
    response = api.post(f"/api/v1/webhooks/deliveries/{delivery.id}/retry", format="json")
    assert response.status_code == 200 and response.json()["status"] == "delivered"
    assert api.get("/api/v1/webhooks/deliveries?status=delivered").json()["count"] == 1


def test_replayed_payment_request_does_not_emit_events_twice(tenant, hooked, receiver, api):
    customer, merchant = hooked
    key = new_key()
    pay(api, customer, merchant, 500, key=key)
    pay(api, customer, merchant, 500, key=key)
    assert WebhookDelivery.objects.count() == 2  # authorized + captured, once
