"""Payment lifecycle: pending -> authorized -> captured -> refunded, or failed.

Authorization places a hold (payer -> holds account); capture moves the held funds to the
payee; a void releases the hold; a refund moves money back from the payee. Each step is a
balanced ledger transaction, and every state change happens under a row lock on the payment.
"""

from django.db import transaction
from django.utils import timezone

from core.errors import BusinessRuleViolation
from core.models import ApiClient
from core.prometheus import PAYMENTS_CREATED
from fraud import engine
from fraud.models import FraudAssessment, ReviewItem
from ledger.models import Account, LedgerTransaction
from ledger.services import InsufficientFunds, post_transfer, system_account
from webhooks import services as webhooks

from .models import Payment, Refund

ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    Payment.Status.PENDING: {Payment.Status.AUTHORIZED, Payment.Status.FAILED},
    Payment.Status.AUTHORIZED: {Payment.Status.CAPTURED, Payment.Status.FAILED},
    Payment.Status.CAPTURED: {Payment.Status.REFUNDED},
    Payment.Status.REFUNDED: set(),
    Payment.Status.FAILED: set(),
}


class InvalidTransition(BusinessRuleViolation):
    default_code = "invalid_state_transition"


def transition(payment: Payment, new_status: str) -> None:
    if new_status not in ALLOWED_TRANSITIONS[payment.status]:
        raise InvalidTransition(f"Cannot move a payment from '{payment.status}' to '{new_status}'.")
    payment.status = new_status


def payment_payload(payment: Payment) -> dict:
    return {
        "id": str(payment.id),
        "status": payment.status,
        "amount": payment.amount,
        "refunded_amount": payment.refunded_amount,
        "currency": payment.currency,
        "payer": str(payment.payer_id),
        "payee": str(payment.payee_id),
        "failure_reason": payment.failure_reason,
        "fraud_decision": payment.fraud_decision,
        "fraud_score": payment.fraud_score,
    }


def _emit(payment: Payment, event: str) -> None:
    webhooks.emit(payment.client, event, payment_payload(payment))


def _fail(payment: Payment, reason: str) -> None:
    transition(payment, Payment.Status.FAILED)
    payment.failure_reason = reason
    payment.save()
    _emit(payment, "payment.failed")


def _locked(payment_id, client: ApiClient) -> Payment:
    try:
        # of=("self",): lock only the payment row. Joining the client and locking it too would make
        # every operation of a tenant queue on one row and invite deadlocks with foreign-key checks.
        return (
            Payment.objects.select_for_update(of=("self",), no_key=True)
            .select_related("client")
            .get(id=payment_id, client=client)
        )
    except Payment.DoesNotExist:
        raise BusinessRuleViolation("Payment not found.", code="not_found", status_code=404) from None


@transaction.atomic
def create_payment(
    *,
    client: ApiClient,
    payer: Account,
    payee: Account,
    amount: int,
    description: str = "",
    device_id: str = "",
    ip_address: str | None = None,
    metadata: dict | None = None,
    risk_signals: list[float] | None = None,
    capture: bool = True,
) -> Payment:
    if payer.kind != Account.Kind.CUSTOMER or payee.kind != Account.Kind.MERCHANT:
        raise BusinessRuleViolation(
            "Payments go from a customer account to a merchant account.",
            code="invalid_accounts",
            status_code=422,
        )
    if payer.currency != payee.currency:
        raise BusinessRuleViolation("Payer and payee currencies differ.", code="currency_mismatch", status_code=422)

    assessment = engine.assess(payer=payer, amount=amount, device_id=device_id, risk_signals=risk_signals)
    payment = Payment.objects.create(
        client=client,
        payer=payer,
        payee=payee,
        amount=amount,
        currency=payer.currency,
        description=description,
        device_id=device_id,
        ip_address=ip_address,
        metadata=metadata or {},
        auto_capture=capture,
        fraud_score=assessment.score,
        fraud_decision=assessment.decision,
    )
    FraudAssessment.objects.create(
        payment=payment,
        score=assessment.score,
        model_score=assessment.model_score,
        rule_score=assessment.rule_score,
        amount_zscore=assessment.amount_zscore,
        decision=assessment.decision,
        reasons=assessment.reasons,
    )

    if assessment.decision == "block":
        _fail(payment, "fraud_blocked")
    elif assessment.decision == "review":
        ReviewItem.objects.create(payment=payment)
        _emit(payment, "payment.review_required")
    else:
        _authorize_and_maybe_capture(payment)
    PAYMENTS_CREATED.labels(status=payment.status, fraud_decision=payment.fraud_decision).inc()
    return payment


def _authorize_and_maybe_capture(payment: Payment) -> None:
    if payment.auto_capture:
        _charge_immediately(payment)
    else:
        _authorize_hold(payment)


def _charge_immediately(payment: Payment) -> None:
    """Authorize and capture in one step: a single direct transfer, payer -> payee.

    Skipping the holds account keeps every payment's lock footprint to the two accounts
    involved instead of funnelling all traffic through one shared row."""
    try:
        with transaction.atomic():  # a savepoint, so a rejected transfer does not poison the outer transaction
            post_transfer(
                client=payment.client,
                source=payment.payer,
                destination=payment.payee,
                amount=payment.amount,
                kind=LedgerTransaction.Kind.CAPTURE,
                reference=str(payment.id),
                memo="Payment",
            )
    except InsufficientFunds:
        _fail(payment, "insufficient_funds")
        return
    transition(payment, Payment.Status.AUTHORIZED)
    payment.authorized_at = timezone.now()
    _emit(payment, "payment.authorized")
    transition(payment, Payment.Status.CAPTURED)
    payment.captured_at = payment.authorized_at
    payment.save()
    _emit(payment, "payment.captured")


def _authorize_hold(payment: Payment) -> None:
    holds = system_account(payment.client, Account.Kind.HOLDS, payment.currency)
    try:
        with transaction.atomic():
            post_transfer(
                client=payment.client,
                source=payment.payer,
                destination=holds,
                amount=payment.amount,
                kind=LedgerTransaction.Kind.AUTHORIZE,
                reference=str(payment.id),
                memo="Authorization hold",
            )
    except InsufficientFunds:
        _fail(payment, "insufficient_funds")
        return
    transition(payment, Payment.Status.AUTHORIZED)
    payment.authorized_at = timezone.now()
    payment.save()
    _emit(payment, "payment.authorized")


def _capture(payment: Payment) -> None:
    holds = system_account(payment.client, Account.Kind.HOLDS, payment.currency)
    post_transfer(
        client=payment.client,
        source=holds,
        destination=payment.payee,
        amount=payment.amount,
        kind=LedgerTransaction.Kind.CAPTURE,
        reference=str(payment.id),
        memo="Capture of authorized funds",
    )
    transition(payment, Payment.Status.CAPTURED)
    payment.captured_at = timezone.now()
    payment.save()
    _emit(payment, "payment.captured")


@transaction.atomic
def capture_payment(*, client: ApiClient, payment_id) -> Payment:
    payment = _locked(payment_id, client)
    if payment.status != Payment.Status.AUTHORIZED:
        raise InvalidTransition(f"Only authorized payments can be captured (status is '{payment.status}').")
    _capture(payment)
    return payment


@transaction.atomic
def void_payment(*, client: ApiClient, payment_id) -> Payment:
    payment = _locked(payment_id, client)
    if payment.status != Payment.Status.AUTHORIZED:
        raise InvalidTransition(f"Only authorized payments can be voided (status is '{payment.status}').")
    holds = system_account(client, Account.Kind.HOLDS, payment.currency)
    post_transfer(
        client=client,
        source=holds,
        destination=payment.payer,
        amount=payment.amount,
        kind=LedgerTransaction.Kind.VOID,
        reference=str(payment.id),
        memo="Authorization released",
    )
    _fail(payment, "voided")
    return payment


@transaction.atomic
def refund_payment(*, client: ApiClient, payment_id, amount: int | None, reason: str = "") -> Refund:
    payment = _locked(payment_id, client)
    if payment.status != Payment.Status.CAPTURED:
        raise InvalidTransition(f"Only captured payments can be refunded (status is '{payment.status}').")
    remaining = payment.amount - payment.refunded_amount
    amount = remaining if amount is None else amount
    if amount <= 0:
        raise BusinessRuleViolation("Refund amount must be positive.", code="invalid_amount", status_code=422)
    if amount > remaining:
        raise BusinessRuleViolation(
            f"Refund of {amount} exceeds the refundable balance of {remaining}.",
            code="refund_exceeds_payment",
            status_code=422,
        )
    try:
        with transaction.atomic():
            ledger_txn = post_transfer(
                client=client,
                source=payment.payee,
                destination=payment.payer,
                amount=amount,
                kind=LedgerTransaction.Kind.REFUND,
                reference=str(payment.id),
                memo=reason or "Refund",
            )
    except InsufficientFunds:
        raise BusinessRuleViolation(
            "The merchant account has insufficient funds for this refund.",
            code="merchant_insufficient_funds",
            status_code=402,
        ) from None
    refund = Refund.objects.create(payment=payment, amount=amount, reason=reason, ledger_transaction=ledger_txn)
    payment.refunded_amount += amount
    if payment.refunded_amount == payment.amount:
        transition(payment, Payment.Status.REFUNDED)
    payment.save()
    _emit(payment, "payment.refunded")
    return refund


@transaction.atomic
def resolve_review(*, client: ApiClient, payment_id, approve: bool, note: str = "") -> Payment:
    payment = _locked(payment_id, client)
    try:
        review = ReviewItem.objects.select_for_update().get(payment=payment)
    except ReviewItem.DoesNotExist:
        raise BusinessRuleViolation("This payment is not in the review queue.", code="not_in_review") from None
    if review.status != ReviewItem.Status.OPEN or payment.status != Payment.Status.PENDING:
        raise BusinessRuleViolation("This review has already been resolved.", code="already_resolved")
    review.status = ReviewItem.Status.APPROVED if approve else ReviewItem.Status.REJECTED
    review.note = note
    review.resolved_at = timezone.now()
    review.save()
    if approve:
        _authorize_and_maybe_capture(payment)
    else:
        _fail(payment, "fraud_rejected")
    return payment
