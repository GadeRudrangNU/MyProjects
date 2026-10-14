import ipaddress
import logging
import random
import socket
import uuid
from urllib.parse import urlparse

import httpx
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from core.models import ApiClient

from .models import WebhookDelivery

log = logging.getLogger(__name__)


class UnsafeWebhookURL(ValueError):
    pass


def assert_deliverable_url(url: str) -> None:
    """Reject non-http(s) URLs and, unless allowed, hosts that resolve to private networks."""
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise UnsafeWebhookURL("Webhook URL must be an http(s) URL.")
    if settings.PAYFLOW["WEBHOOK_ALLOW_PRIVATE_HOSTS"]:
        return
    try:
        addresses = {info[4][0] for info in socket.getaddrinfo(parsed.hostname, parsed.port or 443)}
    except socket.gaierror as exc:
        raise UnsafeWebhookURL("Webhook host does not resolve.") from exc
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise UnsafeWebhookURL("Webhook host resolves to a non-public address.")


def emit(client: ApiClient, event_type: str, data: dict) -> WebhookDelivery | None:
    """Record an event for the client's endpoint. Call inside the transaction that made the
    change; delivery is enqueued only if that transaction commits."""
    if not client.webhook_url:
        return None
    now = timezone.now()
    delivery = WebhookDelivery.objects.create(
        client=client,
        event_type=event_type,
        payload={
            "id": f"evt_{uuid.uuid4().hex}",
            "type": event_type,
            "created": now.isoformat(),
            "data": data,
        },
        next_attempt_at=now,
        enqueued_at=now,
    )
    transaction.on_commit(lambda: enqueue(delivery.id))
    return delivery


def enqueue(delivery_id) -> None:
    from .tasks import deliver_webhook

    try:
        deliver_webhook.delay(str(delivery_id))
    except Exception:  # broker down: release the row so the periodic sweeper picks it up
        log.warning("could not enqueue webhook %s; sweeper will retry", delivery_id, exc_info=True)
        WebhookDelivery.objects.filter(id=delivery_id).update(enqueued_at=None)


def backoff_seconds(attempt: int, rng: random.Random | None = None) -> float:
    """Exponential backoff with +/-20% jitter: base * 2^(attempt-1), capped."""
    cfg = settings.PAYFLOW
    raw = min(cfg["WEBHOOK_BACKOFF_MAX_SECONDS"], cfg["WEBHOOK_BACKOFF_BASE_SECONDS"] * 2 ** (attempt - 1))
    jitter = (rng or random).uniform(0.8, 1.2)
    return raw * jitter


def post(url: str, body: bytes, headers: dict[str, str], timeout: float) -> int:
    limits = httpx.Timeout(timeout, connect=min(timeout, 3.0))  # a dead host must not hold a worker for long
    response = httpx.post(url, content=body, headers=headers, timeout=limits, follow_redirects=False)
    return response.status_code
