import uuid

from django.db import models
from django.db.models import Q


class Account(models.Model):
    class Kind(models.TextChoices):
        CUSTOMER = "customer"
        MERCHANT = "merchant"
        EXTERNAL = "external"  # the outside world: source of deposits, sink of payouts
        HOLDS = "holds"  # funds reserved by authorized, not yet captured, payments

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client = models.ForeignKey("core.ApiClient", on_delete=models.CASCADE, related_name="accounts")
    name = models.CharField(max_length=120)
    kind = models.CharField(max_length=16, choices=Kind.choices)
    currency = models.CharField(max_length=3, default="USD")
    allow_negative = models.BooleanField(default=False)
    # Running total of this account's entries, maintained under a row lock in the same
    # transaction that inserts the entries. The entries are the source of truth; the
    # reconciliation job proves the two agree.
    cached_balance = models.BigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            # Last line of defence against overdrafts, independent of application code.
            models.CheckConstraint(
                condition=Q(allow_negative=True) | Q(cached_balance__gte=0),
                name="account_no_overdraft",
            ),
        ]
        indexes = [models.Index(fields=["client", "kind"])]

    def __str__(self) -> str:
        return f"{self.name} ({self.kind})"


class LedgerTransaction(models.Model):
    """A group of entries that sum to zero. Immutable once written."""

    class Kind(models.TextChoices):
        DEPOSIT = "deposit"
        AUTHORIZE = "authorize"
        CAPTURE = "capture"
        VOID = "void"
        REFUND = "refund"
        PAYOUT = "payout"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client = models.ForeignKey("core.ApiClient", on_delete=models.CASCADE, related_name="ledger_transactions")
    kind = models.CharField(max_length=16, choices=Kind.choices)
    reference = models.CharField(max_length=64, blank=True, db_index=True)
    memo = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)


class Entry(models.Model):
    """One side of a transaction. Positive amount = credit (money in), negative = debit."""

    transaction = models.ForeignKey(LedgerTransaction, on_delete=models.PROTECT, related_name="entries")
    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="entries")
    amount = models.BigIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.CheckConstraint(condition=~Q(amount=0), name="entry_nonzero")]
        indexes = [models.Index(fields=["account", "id"])]
        db_table = "ledger_entry"

    @classmethod
    def balance_of(cls, account_id) -> int:
        return cls.objects.filter(account_id=account_id).aggregate(total=models.Sum("amount"))["total"] or 0
