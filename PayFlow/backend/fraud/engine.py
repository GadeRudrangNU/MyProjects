"""Real-time fraud scoring: transparent rules plus a statistical model.

Every signal is mapped onto one 0..1 risk scale where 0.5 means "send to manual review"
and 0.8 means "block". The final score is the highest signal and the decision follows from
it, so the score, the decision and the listed reasons always agree.
"""

import statistics
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from django.conf import settings
from django.utils import timezone

from ledger.models import Account
from payments.models import Payment

from .model import FraudModel, load_model

REVIEW_AT = 0.5
BLOCK_AT = 0.8


@dataclass
class Assessment:
    score: float = 0.0
    decision: str = "approve"
    model_score: float | None = None
    rule_score: float = 0.0
    amount_zscore: float | None = None
    reasons: list[dict[str, Any]] = field(default_factory=list)


def _cfg() -> dict:
    return settings.PAYFLOW["FRAUD"]


def decision_for(score: float) -> str:
    if score >= BLOCK_AT:
        return "block"
    if score >= REVIEW_AT:
        return "review"
    return "approve"


def model_risk(model: FraudModel, probability: float) -> float:
    """Piecewise-linear map from model probability onto the shared risk scale, anchored at
    the review and block thresholds chosen from the cost analysis at training time."""
    cfg = _cfg()
    review_t = cfg["MODEL_REVIEW_THRESHOLD"] or model.review_threshold
    block_t = cfg["MODEL_BLOCK_THRESHOLD"] or model.block_threshold
    if probability < review_t:
        return REVIEW_AT * probability / review_t
    if probability < block_t:
        return REVIEW_AT + (BLOCK_AT - REVIEW_AT) * (probability - review_t) / (block_t - review_t)
    return BLOCK_AT + (1 - BLOCK_AT) * min(1.0, (probability - block_t) / max(1e-9, 1 - block_t))


def amount_zscore(payer: Account, amount: int, history_size: int = 50) -> float | None:
    cfg = _cfg()
    amounts = list(
        Payment.objects.filter(
            payer=payer,
            status__in=[Payment.Status.AUTHORIZED, Payment.Status.CAPTURED, Payment.Status.REFUNDED],
        )
        .order_by("-created_at")
        .values_list("amount", flat=True)[:history_size]
    )
    if len(amounts) < cfg["ZSCORE_MIN_HISTORY"]:
        return None
    mean = statistics.fmean(amounts)
    # Floor the deviation so a customer who always pays exactly the same amount does not
    # turn every small change into an enormous z-score.
    sd = max(statistics.pstdev(amounts), 0.1 * mean, 1.0)
    return (amount - mean) / sd


def assess(
    *,
    payer: Account,
    amount: int,
    device_id: str = "",
    risk_signals: list[float] | None = None,
) -> Assessment:
    cfg = _cfg()
    result = Assessment()
    signals: list[float] = []

    def add(code: str, risk: float, detail: str) -> None:
        signals.append(risk)
        result.reasons.append({"code": code, "risk": round(risk, 3), "detail": detail})

    now = timezone.now()

    # Rule: velocity
    window = timedelta(seconds=cfg["VELOCITY_WINDOW_SECONDS"])
    recent = Payment.objects.filter(payer=payer, created_at__gte=now - window).count() + 1
    if recent >= cfg["VELOCITY_BLOCK_COUNT"]:
        add("velocity", 0.9, f"{recent} payments in {cfg['VELOCITY_WINDOW_SECONDS']}s")
    elif recent >= cfg["VELOCITY_REVIEW_COUNT"]:
        add("velocity", 0.6, f"{recent} payments in {cfg['VELOCITY_WINDOW_SECONDS']}s")

    # Rule: unusually large absolute amount
    if amount >= cfg["LARGE_AMOUNT_REVIEW"]:
        add("large_amount", 0.55, f"amount {amount / 100:,.2f} exceeds {cfg['LARGE_AMOUNT_REVIEW'] / 100:,.2f}")

    # Statistic: amount z-score against this customer's own history
    z = amount_zscore(payer, amount)
    result.amount_zscore = None if z is None else round(z, 3)
    if z is not None and z >= cfg["ZSCORE_REVIEW"]:
        span = max(cfg["ZSCORE_BLOCK"] - cfg["ZSCORE_REVIEW"], 1e-9)
        risk = REVIEW_AT + (BLOCK_AT - REVIEW_AT + 0.05) * min(1.0, (z - cfg["ZSCORE_REVIEW"]) / span)
        add("amount_zscore", risk, f"amount is {z:.1f} standard deviations above this customer's norm")

    # Rule: unseen device on an established account, for a meaningful amount
    if device_id and amount >= cfg["NEW_DEVICE_AMOUNT_REVIEW"]:
        history = Payment.objects.filter(payer=payer).exclude(status=Payment.Status.FAILED)
        if history.count() >= cfg["NEW_DEVICE_MIN_HISTORY"] and not history.filter(device_id=device_id).exists():
            add("new_device", 0.5, "first payment from this device on an established account")

    result.rule_score = round(max(signals, default=0.0), 4)

    # Model: logistic regression trained on real card-fraud data
    model = load_model() if cfg["MODEL_ENABLED"] else None
    if model is not None and risk_signals is not None:
        probability = model.predict_proba(risk_signals, amount)
        risk = model_risk(model, probability)
        result.model_score = round(probability, 6)
        if risk >= REVIEW_AT:
            add("model", risk, f"model fraud probability {probability:.3f}")
        signals.append(risk)

    result.score = round(max(signals, default=0.0), 4)
    result.decision = decision_for(result.score)
    return result
