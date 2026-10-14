import json
import logging
from datetime import timedelta
from typing import Any

from celery import shared_task
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from . import services
from .models import WebhookDelivery
from .signing import SIGNATURE_HEADER, signature_header

log = logging.getLogger(__name__)
LEASE = timedelta(seconds=60)  # how long an attempt in flight blocks other attempts
QUEUE_LEASE = timedelta(seconds=120)  # how long a queued task is trusted before the sweeper re-queues


def _claim(delivery_id: str):
    """Take a short lease on a due delivery so two workers never send the same attempt."""
    with transaction.atomic():
        delivery = (
            WebhookDelivery.objects.select_for_update(skip_locked=True, of=("self",), no_key=True)
            .select_related("client")
            .filter(id=delivery_id, status=WebhookDelivery.Status.PENDING, next_attempt_at__lte=timezone.now())
            .first()
        )
        if delivery is None:
            return None
        delivery.attempts += 1
        delivery.next_attempt_at = timezone.now() + LEASE
        delivery.save(update_fields=["attempts", "next_attempt_at"])
        return delivery


@shared_task(name="webhooks.deliver")
def deliver_webhook(delivery_id: str) -> str:
    delivery = _claim(delivery_id)
    if delivery is None:
        return "skipped"
    client = delivery.client
    cfg = settings.PAYFLOW
    status_code: int | None = None
    error = ""
    try:
        services.assert_deliverable_url(client.webhook_url)
        body = json.dumps(delivery.payload, separators=(",", ":")).encode()
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "PayFlow-Webhooks/1.0",
            "PayFlow-Event": delivery.event_type,
            "PayFlow-Delivery": str(delivery.id),
            SIGNATURE_HEADER: signature_header(client.webhook_secret, body),
        }
        status_code = services.post(client.webhook_url, body, headers, cfg["WEBHOOK_TIMEOUT_SECONDS"])
        success = 200 <= status_code < 300
        if not success:
            error = f"HTTP {status_code}"
    except Exception as exc:
        success = False
        error = f"{type(exc).__name__}: {exc}"[:255]

    now = timezone.now()
    fields: dict[str, Any] = {"last_status_code": status_code, "last_error": error, "enqueued_at": None}
    if success:
        fields.update(status=WebhookDelivery.Status.DELIVERED, delivered_at=now, next_attempt_at=None)
    elif delivery.attempts >= cfg["WEBHOOK_MAX_ATTEMPTS"]:
        fields.update(status=WebhookDelivery.Status.DEAD, next_attempt_at=None)
    else:
        fields.update(next_attempt_at=now + timedelta(seconds=services.backoff_seconds(delivery.attempts)))
    WebhookDelivery.objects.filter(id=delivery.id).update(**fields)
    return "delivered" if success else str(fields.get("status", "retry"))


@shared_task(name="webhooks.dispatch_due_deliveries")
def dispatch_due_deliveries(batch: int = 500) -> int:
    """Sweeper: queue deliveries whose retry time has come (or whose queued task was lost).

    Each row is stamped ``enqueued_at`` as it is queued, so a delivery waiting in a busy queue
    is not queued again on every sweep; the stamp expires after QUEUE_LEASE in case the task was lost."""
    now = timezone.now()
    with transaction.atomic():
        due = list(
            WebhookDelivery.objects.select_for_update(skip_locked=True, no_key=True)
            .filter(status=WebhookDelivery.Status.PENDING, next_attempt_at__lte=now)
            .filter(Q(enqueued_at__isnull=True) | Q(enqueued_at__lt=now - QUEUE_LEASE))
            .order_by("next_attempt_at")
            .values_list("id", flat=True)[:batch]
        )
        WebhookDelivery.objects.filter(id__in=due).update(enqueued_at=now)
    for delivery_id in due:
        services.enqueue(delivery_id)
    return len(due)
