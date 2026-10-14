import pytest
from django.db import IntegrityError, connection, transaction

from ledger.models import Account, Entry, LedgerTransaction
from ledger.services import InsufficientFunds, LedgerError, deposit, derived_balance, post_transfer


@pytest.fixture
def accounts(tenant):
    alice = Account.objects.create(client=tenant, name="Alice", kind=Account.Kind.CUSTOMER)
    shop = Account.objects.create(client=tenant, name="Shop", kind=Account.Kind.MERCHANT)
    return alice, shop


def test_transfer_posts_two_balanced_entries(tenant, accounts):
    alice, shop = accounts
    deposit(client=tenant, account=alice, amount=5_000)
    with transaction.atomic():
        txn = post_transfer(client=tenant, source=alice, destination=shop, amount=1_200, kind="capture")
    entries = list(txn.entries.order_by("amount"))
    assert [e.amount for e in entries] == [-1_200, 1_200]
    assert derived_balance(alice.id) == 3_800
    assert derived_balance(shop.id) == 1_200
    alice.refresh_from_db()
    assert alice.cached_balance == 3_800


def test_overdraft_is_rejected_and_leaves_no_trace(tenant, accounts):
    alice, shop = accounts
    deposit(client=tenant, account=alice, amount=500)
    before = Entry.objects.count()
    with pytest.raises(InsufficientFunds), transaction.atomic():
        post_transfer(client=tenant, source=alice, destination=shop, amount=501, kind="capture")
    assert Entry.objects.count() == before
    assert derived_balance(alice.id) == 500


def test_rejects_bad_transfers(tenant, accounts):
    alice, shop = accounts
    with transaction.atomic():
        with pytest.raises(LedgerError):
            post_transfer(client=tenant, source=alice, destination=shop, amount=0, kind="capture")
        with pytest.raises(LedgerError):
            post_transfer(client=tenant, source=alice, destination=alice, amount=5, kind="capture")


def test_transfer_requires_a_transaction(tenant, accounts):
    alice, shop = accounts
    with pytest.raises(LedgerError):
        post_transfer(client=tenant, source=alice, destination=shop, amount=5, kind="capture")


@pytest.mark.django_db(transaction=True)
def test_database_rejects_an_unbalanced_transaction(tenant):
    alice = Account.objects.create(client=tenant, name="A", kind=Account.Kind.CUSTOMER)
    with pytest.raises(IntegrityError, match="unbalanced"), transaction.atomic():
        txn = LedgerTransaction.objects.create(client=tenant, kind="deposit")
        Entry.objects.create(transaction=txn, account=alice, amount=100)  # no matching debit


@pytest.mark.django_db(transaction=True)
def test_database_makes_entries_append_only(tenant):
    alice = Account.objects.create(client=tenant, name="A", kind=Account.Kind.CUSTOMER)
    deposit(client=tenant, account=alice, amount=100)
    entry = Entry.objects.filter(account=alice).first()
    with pytest.raises(IntegrityError, match="append-only"), transaction.atomic():
        Entry.objects.filter(pk=entry.pk).update(amount=1_000_000)
    with pytest.raises(IntegrityError, match="append-only"), transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM ledger_entry WHERE id = %s", [entry.pk])


def test_database_rejects_overdrawn_balance_even_if_code_is_bypassed(tenant):
    alice = Account.objects.create(client=tenant, name="A", kind=Account.Kind.CUSTOMER)
    with pytest.raises(IntegrityError, match="account_no_overdraft"), transaction.atomic():
        Account.objects.filter(pk=alice.pk).update(cached_balance=-1)
