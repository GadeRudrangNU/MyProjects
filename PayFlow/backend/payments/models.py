import uuid

from django.db import models
from django.db.models import F, Q


class Payment(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending"
        AUTHORIZED = "authorized"
        CAPTURED = "captured"
        REFUNDED = "refunded"
        FAILED = "failed"

    class Decision(models.TextChoices):
        APPROVE = "approve"
        REVIEW = "review"
        BLOCK = "block"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client = models.ForeignKey("core.ApiClient", on_delete=models.CASCADE, related_name="payments")
    payer = models.ForeignKey("ledger.Account", on_delete=models.PROTECT, related_name="payments_made")
    payee = models.ForeignKey("ledger.Account", on_delete=models.PROTECT, related_name="payments_received")
    amount = models.BigIntegerField()
    currency = models.CharField(max_length=3, default="USD")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    auto_capture = models.BooleanField(default=True)
    refunded_amount = models.BigIntegerField(default=0)
    description = models.CharField(max_length=255, blank=True)
    device_id = models.CharField(max_length=120, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    fraud_score = models.FloatField(null=True, blank=True)
    fraud_decision = models.CharField(max_length=8, choices=Decision.choices, blank=True)
    failure_reason = models.CharField(max_length=64, blank=True)
    authorized_at = models.DateTimeField(null=True, blank=True)
    captured_at = models.DateTimeField(null=True, blank=True)
    settled_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(condition=Q(amount__gt=0), name="payment_amount_positive"),
            # A refund can never exceed the original payment, enforced by the database.
            models.CheckConstraint(
                condition=Q(refunded_amount__gte=0) & Q(refunded_amount__lte=F("amount")),
                name="payment_refund_within_amount",
            ),
        ]
        indexes = [
            models.Index(fields=["client", "-created_at"]),
            models.Index(fields=["payer", "-created_at"]),
            models.Index(fields=["status", "captured_at"]),
        ]


class Refund(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    payment = models.ForeignKey(Payment, on_delete=models.PROTECT, related_name="refunds")
    amount = models.BigIntegerField()
    reason = models.CharField(max_length=255, blank=True)
    ledger_transaction = models.ForeignKey("ledger.LedgerTransaction", on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [models.CheckConstraint(condition=Q(amount__gt=0), name="refund_amount_positive")]
