"""The only code allowed to move money.

Every movement is a balanced pair of entries inside a database transaction, with the
affected account rows locked (SELECT ... FOR UPDATE) in a fixed order so concurrent
transfers can neither overdraw an account nor deadlock each other.
"""

from collections.abc import Iterable
from uuid import UUID

from django.db import connection, transaction
from django.db.models import F

from core.models import ApiClient
from core.prometheus import INSUFFICIENT_FUNDS, LEDGER_POSTINGS

from .models import Account, Entry, LedgerTransaction


class LedgerError(Exception):
    pass


class InsufficientFunds(LedgerError):
    def __init__(self, account: Account, needed: int):
        super().__init__(f"Account {account.id} has {account.cached_balance}, needs {needed}")
        self.account = account
        self.needed = needed


SYSTEM_ACCOUNTS = {
    Account.Kind.EXTERNAL: "External funding and payouts",
    Account.Kind.HOLDS: "Authorization holds",
}


def ensure_system_accounts(client: ApiClient, currency: str = "USD") -> dict[str, Account]:
    accounts: dict[str, Account] = {}
    for kind, name in SYSTEM_ACCOUNTS.items():
        account, _ = Account.objects.get_or_create(
            client=client,
            kind=kind,
            currency=currency,
            defaults={"name": name, "allow_negative": kind == Account.Kind.EXTERNAL},
        )
        accounts[kind] = account
    return accounts


def system_account(client: ApiClient, kind: str, currency: str) -> Account:
    return ensure_system_accounts(client, currency)[kind]


def lock_accounts(account_ids: Iterable[UUID]) -> dict[UUID, Account]:
    """Lock rows in primary-key order: a global ordering makes deadlocks impossible.

    ``no_key=True`` takes FOR NO KEY UPDATE, which still excludes other writers but does not
    conflict with the FOR KEY SHARE locks PostgreSQL takes when checking foreign keys that
    point at these rows (every payment and ledger entry references an account). With plain
    FOR UPDATE those checks, which run at commit time, can deadlock against transfers."""
    locked = Account.objects.select_for_update(no_key=True).filter(id__in=set(account_ids)).order_by("id")
    return {account.id: account for account in locked}


def post_transfer(
    *,
    client: ApiClient,
    source: Account,
    destination: Account,
    amount: int,
    kind: str,
    reference: str = "",
    memo: str = "",
) -> LedgerTransaction:
    if not connection.in_atomic_block:
        raise LedgerError("post_transfer must run inside transaction.atomic()")
    if amount <= 0:
        raise LedgerError("Transfer amount must be positive")
    if source.id == destination.id:
        raise LedgerError("Source and destination must differ")
    if source.currency != destination.currency:
        raise LedgerError("Cross-currency transfers are not supported")
    if source.client_id != client.id or destination.client_id != client.id:
        raise LedgerError("Accounts must belong to the posting client")

    locked = lock_accounts([source.id, destination.id])
    src, dst = locked[source.id], locked[destination.id]  # fresh rows, read under the lock
    if not src.allow_negative and src.cached_balance < amount:
        INSUFFICIENT_FUNDS.inc()
        raise InsufficientFunds(src, amount)

    txn = LedgerTransaction.objects.create(client=client, kind=kind, reference=reference, memo=memo)
    Entry.objects.bulk_create(
        [
            Entry(transaction=txn, account=src, amount=-amount),
            Entry(transaction=txn, account=dst, amount=amount),
        ]
    )
    Account.objects.filter(pk=src.pk).update(cached_balance=F("cached_balance") - amount)
    Account.objects.filter(pk=dst.pk).update(cached_balance=F("cached_balance") + amount)
    LEDGER_POSTINGS.labels(kind=kind).inc()
    return txn


def derived_balance(account_id: UUID) -> int:
    """Balance computed from the entries themselves (the source of truth)."""
    return Entry.balance_of(account_id)


@transaction.atomic
def deposit(*, client: ApiClient, account: Account, amount: int, reference: str = "") -> LedgerTransaction:
    external = system_account(client, Account.Kind.EXTERNAL, account.currency)
    return post_transfer(
        client=client,
        source=external,
        destination=account,
        amount=amount,
        kind=LedgerTransaction.Kind.DEPOSIT,
        reference=reference,
        memo="Deposit from external funding",
    )
