import uuid

from django.db import models


class ReconciliationRun(models.Model):
    class Status(models.TextChoices):
        OK = "ok"
        MISMATCH = "mismatch"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client = models.ForeignKey("core.ApiClient", on_delete=models.CASCADE, related_name="reconciliation_runs")
    status = models.CharField(max_length=10, choices=Status.choices)
    accounts_checked = models.PositiveIntegerField(default=0)
    transactions_checked = models.PositiveIntegerField(default=0)
    mismatch_count = models.PositiveIntegerField(default=0)
    findings = models.JSONField(default=list)
    started_at = models.DateTimeField()
    finished_at = models.DateTimeField()

    class Meta:
        ordering = ["-started_at"]


class Settlement(models.Model):
    """A payout batch: captured payments swept from a merchant account to the bank."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client = models.ForeignKey("core.ApiClient", on_delete=models.CASCADE, related_name="settlements")
    account = models.ForeignKey("ledger.Account", on_delete=models.PROTECT, related_name="settlements")
    amount = models.BigIntegerField()
    payment_count = models.PositiveIntegerField()
    ledger_transaction = models.ForeignKey("ledger.LedgerTransaction", on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
