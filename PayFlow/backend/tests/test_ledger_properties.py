"""Property-based tests: whatever sequence of operations Hypothesis invents, the ledger
invariants must hold afterwards."""

import pytest
from django.db import connection
from django.db.models import Sum
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from backoffice.services import reconcile
from core.errors import BusinessRuleViolation
from core.models import ApiClient
from ledger.models import Account, Entry, LedgerTransaction
from ledger.services import deposit, derived_balance
from payments import services
from payments.models import Payment

pytestmark = [pytest.mark.django_db, pytest.mark.usefixtures("no_fraud")]

ops = st.one_of(
    st.tuples(st.just("deposit"), st.integers(0, 2), st.integers(1, 50_000)),
    st.tuples(st.just("pay"), st.integers(0, 2), st.integers(0, 1), st.integers(1, 30_000), st.booleans()),
    st.tuples(st.just("capture"), st.integers(0, 40)),
    st.tuples(st.just("void"), st.integers(0, 40)),
    st.tuples(st.just("refund"), st.integers(0, 40), st.one_of(st.none(), st.integers(1, 30_000))),
)


def check_invariants(client):
    connection.cursor().execute("SET CONSTRAINTS ALL IMMEDIATE")  # run the deferred balance trigger now
    # 1. every transaction's entries sum to zero, and so does the whole ledger
    for txn in LedgerTransaction.objects.filter(client=client):
        assert txn.entries.aggregate(s=Sum("amount"))["s"] == 0
    assert Entry.objects.filter(account__client=client).aggregate(s=Sum("amount"))["s"] in (0, None)
    # 2. every balance equals the sum of its entries, and ordinary accounts never go negative
    for account in Account.objects.filter(client=client):
        assert account.cached_balance == derived_balance(account.id)
        if not account.allow_negative:
            assert account.cached_balance >= 0
    # 3. a refund never exceeds the original payment, and refund rows add up
    for payment in Payment.objects.filter(client=client):
        assert 0 <= payment.refunded_amount <= payment.amount
        assert sum(r.amount for r in payment.refunds.all()) == payment.refunded_amount
        if payment.status == Payment.Status.REFUNDED:
            assert payment.refunded_amount == payment.amount
    # 4. an independent reconciliation agrees
    assert reconcile(client).status == "ok"


@settings(max_examples=40, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(st.lists(ops, min_size=1, max_size=25))
def test_ledger_invariants_hold_for_any_sequence_of_operations(operations):
    client, _ = ApiClient.create_with_key("property-test")
    customers = [Account.objects.create(client=client, name=f"c{i}", kind="customer") for i in range(3)]
    merchants = [Account.objects.create(client=client, name=f"m{i}", kind="merchant") for i in range(2)]
    payments: list[Payment] = []

    for op in operations:
        try:
            match op[0]:
                case "deposit":
                    deposit(client=client, account=customers[op[1]], amount=op[2])
                case "pay":
                    payments.append(
                        services.create_payment(
                            client=client,
                            payer=customers[op[1]],
                            payee=merchants[op[2]],
                            amount=op[3],
                            capture=op[4],
                        )
                    )
                case "capture" | "void" | "refund" if payments:
                    target = payments[op[1] % len(payments)]
                    if op[0] == "capture":
                        services.capture_payment(client=client, payment_id=target.id)
                    elif op[0] == "void":
                        services.void_payment(client=client, payment_id=target.id)
                    else:
                        services.refund_payment(client=client, payment_id=target.id, amount=op[2])
        except BusinessRuleViolation:
            pass  # rejected operations are fine; they just must not corrupt anything
        check_invariants(client)


@settings(max_examples=60, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(st.lists(st.integers(1, 40_000), min_size=1, max_size=15), st.integers(1, 200_000))
def test_a_payer_can_never_spend_more_than_they_deposited(amounts, funds):
    client, _ = ApiClient.create_with_key("spend-test")
    payer = Account.objects.create(client=client, name="payer", kind="customer")
    payee = Account.objects.create(client=client, name="payee", kind="merchant")
    deposit(client=client, account=payer, amount=funds)
    for amount in amounts:
        services.create_payment(client=client, payer=payer, payee=payee, amount=amount)
    payer.refresh_from_db()
    payee.refresh_from_db()
    assert payee.cached_balance <= funds
    assert payer.cached_balance + payee.cached_balance == funds
    assert payer.cached_balance >= 0
