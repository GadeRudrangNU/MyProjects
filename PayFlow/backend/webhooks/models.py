import uuid

from django.db import models


class WebhookDelivery(models.Model):
    """Transactional outbox: written in the same transaction as the state change it
    describes, so an event can never be lost or announced for a rolled-back change."""

    class Status(models.TextChoices):
        PENDING = "pending"
        DELIVERED = "delivered"
        DEAD = "dead"  # retries exhausted

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client = models.ForeignKey("core.ApiClient", on_delete=models.CASCADE, related_name="webhook_deliveries")
    event_type = models.CharField(max_length=64)
    payload = models.JSONField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    attempts = models.PositiveSmallIntegerField(default=0)
    next_attempt_at = models.DateTimeField(null=True, blank=True)
    # When a delivery task was last queued for this row; stops the sweeper queueing it again while it waits.
    enqueued_at = models.DateTimeField(null=True, blank=True)
    last_status_code = models.PositiveSmallIntegerField(null=True, blank=True)
    last_error = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    delivered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["status", "next_attempt_at"])]
