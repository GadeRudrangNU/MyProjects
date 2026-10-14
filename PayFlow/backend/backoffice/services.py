from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from ledger.models import Account, Entry, LedgerTransaction
from ledger.services import InsufficientFunds, post_transfer, system_account
from payments.models import Payment

from .models import ReconciliationRun, Settlement

MAX_FINDINGS = 200


def reconcile(client) -> ReconciliationRun:
    """Independently re-derive every balance of one client's ledger from the entries and report anything that differs.

    Checks: (1) each account's running balance equals the sum of its entries, (2) every
    ledger transaction sums to zero, (3) the whole ledger sums to zero, (4) no ordinary
    account is negative, (5) every captured payment was credited to its payee exactly once.
    """
    started = timezone.now()
    findings: list[dict] = []

    accounts = Account.objects.filter(client=client).annotate(derived=Coalesce(Sum("entries__amount"), 0))
    accounts_checked = 0
    for account in accounts.iterator():
        accounts_checked += 1
        if account.cached_balance != account.derived:
            findings.append(
                {
                    "type": "balance_mismatch",
                    "account": str(account.id),
                    "cached": account.cached_balance,
                    "derived": account.derived,
                }
            )
        if account.derived < 0 and not account.allow_negative:
            findings.append({"type": "negative_balance", "account": str(account.id), "balance": account.derived})

    unbalanced = (
        Entry.objects.filter(account__client=client)
        .values("transaction_id")
        .annotate(total=Sum("amount"))
        .exclude(total=0)
    )
    for row in unbalanced:
        findings.append(
            {"type": "unbalanced_transaction", "transaction": str(row["transaction_id"]), "sum": row["total"]}
        )

    grand_total = Entry.objects.filter(account__client=client).aggregate(total=Coalesce(Sum("amount"), 0))["total"]
    if grand_total != 0:
        findings.append({"type": "ledger_not_zero_sum", "sum": grand_total})

    credited = {
        row["transaction__reference"]: row["total"]
        for row in Entry.objects.filter(
            account__client=client, transaction__kind=LedgerTransaction.Kind.CAPTURE, amount__gt=0
        )
        .values("transaction__reference")
        .annotate(total=Sum("amount"))
    }
    captured = Payment.objects.filter(client=client, status__in=[Payment.Status.CAPTURED, Payment.Status.REFUNDED])
    for payment_id, amount in captured.values_list("id", "amount").iterator():
        if credited.get(str(payment_id), 0) != amount:
            findings.append(
                {
                    "type": "capture_mismatch",
                    "payment": str(payment_id),
                    "amount": amount,
                    "credited": credited.get(str(payment_id), 0),
                }
            )

    return ReconciliationRun.objects.create(
        client=client,
        status=ReconciliationRun.Status.MISMATCH if findings else ReconciliationRun.Status.OK,
        accounts_checked=accounts_checked,
        transactions_checked=LedgerTransaction.objects.filter(client=client).count(),
        mismatch_count=len(findings),
        findings=findings[:MAX_FINDINGS],
        started_at=started,
        finished_at=timezone.now(),
    )


def run_settlement(client=None, delay_seconds: int | None = None) -> list[Settlement]:
    """Sweep captured payments older than the settlement delay into one payout per merchant."""
    delay = settings.PAYFLOW["SETTLEMENT_DELAY_SECONDS"] if delay_seconds is None else delay_seconds
    cutoff = timezone.now() - timedelta(seconds=delay)

    due = Payment.objects.filter(
        **({"client": client} if client else {}),
        status__in=[Payment.Status.CAPTURED, Payment.Status.REFUNDED],
        settled_at__isnull=True,
        captured_at__lte=cutoff,
    )
    payee_ids = list(due.values_list("payee_id", flat=True).distinct())
    settlements: list[Settlement] = []
    for payee_id in payee_ids:
        with transaction.atomic():
            # Same lock order as capture and refund: payment rows first, accounts last (inside post_transfer).
            payee = Account.objects.select_related("client").get(id=payee_id)
            batch = list(due.filter(payee=payee).select_for_update(skip_locked=True, no_key=True))
            if not batch:
                continue
            net = sum(p.amount - p.refunded_amount for p in batch)
            ledger_txn = None
            if net > 0:
                external = system_account(payee.client, Account.Kind.EXTERNAL, payee.currency)
                try:
                    with transaction.atomic():
                        ledger_txn = post_transfer(
                            client=payee.client,
                            source=payee,
                            destination=external,
                            amount=net,
                            kind=LedgerTransaction.Kind.PAYOUT,
                            reference=str(payee.id),
                            memo="Settlement payout",
                        )
                except InsufficientFunds:
                    continue  # try again on the next run
            Payment.objects.filter(id__in=[p.id for p in batch]).update(settled_at=timezone.now())
            if ledger_txn is not None:
                settlements.append(
                    Settlement.objects.create(
                        client=payee.client,
                        account=payee,
                        amount=net,
                        payment_count=len(batch),
                        ledger_transaction=ledger_txn,
                    )
                )
    return settlements
