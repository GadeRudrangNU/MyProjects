import csv
import gzip
from datetime import timedelta
from pathlib import Path

import pytest
from django.utils import timezone

from fraud.engine import assess
from fraud.model import load_model
from ledger.models import Account
from ledger.services import deposit
from payments.models import Payment
from tests.conftest import new_key, pay

SAMPLE = Path(__file__).resolve().parents[2] / "ml" / "sample" / "holdout_sample.csv.gz"


@pytest.fixture
def rich(tenant):
    """A customer with plenty of funds so fraud rules, not balances, decide outcomes."""
    customer = Account.objects.create(client=tenant, name="Rita", kind=Account.Kind.CUSTOMER)
    merchant = Account.objects.create(client=tenant, name="Shop", kind=Account.Kind.MERCHANT)
    deposit(client=tenant, account=customer, amount=50_000_000)
    return customer, merchant


@pytest.fixture
def rules_only(settings):
    import copy

    cfg = copy.deepcopy(settings.PAYFLOW)
    cfg["FRAUD"]["MODEL_ENABLED"] = False
    settings.PAYFLOW = cfg


def fraud_of(response):
    return response.json()["fraud"]


@pytest.mark.usefixtures("rules_only")
class TestRules:
    def test_normal_payment_is_approved_with_no_reasons(self, api, rich):
        body = pay(api, *rich, 4_200).json()
        assert body["fraud_decision"] == "approve" and body["status"] == "captured"
        assert body["fraud"]["reasons"] == []

    def test_velocity_sends_the_fifth_payment_to_review_and_blocks_the_tenth(self, api, rich):
        customer, merchant = rich
        decisions = [pay(api, customer, merchant, 1_000).json()["fraud_decision"] for _ in range(10)]
        assert decisions[:4] == ["approve"] * 4
        assert decisions[4:9] == ["review"] * 5
        assert decisions[9] == "block"

    def test_large_amount_goes_to_review(self, api, rich):
        response = pay(api, *rich, 600_000)
        assert response.status_code == 202
        assert response.json()["status"] == "pending"
        assert fraud_of(response)["reasons"][0]["code"] == "large_amount"

    def test_amount_far_above_the_customers_norm_is_scored_by_z_score(self, api, rich):
        customer, merchant = rich
        for _ in range(6):  # a quiet history: six payments of 50.00, three days ago
            Payment.objects.create(
                client=customer.client,
                payer=customer,
                payee=merchant,
                amount=5_000,
                currency="USD",
                status=Payment.Status.CAPTURED,
            )
        Payment.objects.update(created_at=timezone.now() - timedelta(days=3))
        odd = pay(api, customer, merchant, 7_500)  # 5 standard deviations (floored at 10% of the mean)
        assert odd.json()["fraud_decision"] == "review"
        assert 4 <= fraud_of(odd)["amount_zscore"] < 10
        wild = pay(api, customer, merchant, 60_000)
        assert wild.json()["fraud_decision"] == "block"

    def test_unseen_device_on_an_established_account_is_reviewed(self, api, rich):
        customer, merchant = rich
        for _ in range(3):
            pay(api, customer, merchant, 25_000, device_id="phone-1")
        Payment.objects.update(created_at=timezone.now() - timedelta(days=2))  # keep velocity out of it
        again = pay(api, customer, merchant, 25_000, device_id="phone-1")
        assert again.json()["fraud_decision"] == "approve"
        new = pay(api, customer, merchant, 25_000, device_id="laptop-9")
        assert new.status_code == 202
        assert fraud_of(new)["reasons"][0]["code"] == "new_device"

    def test_new_device_alone_is_fine_for_a_new_customer(self, api, rich):
        assert pay(api, *rich, 25_000, device_id="brand-new").json()["fraud_decision"] == "approve"


@pytest.mark.usefixtures("rules_only")
class TestReviewWorkflow:
    def flagged(self, api, rich):
        return pay(api, *rich, 600_000).json()

    def balance(self, api, account):
        return api.get(f"/api/v1/accounts/{account.id}/balance").json()["balance"]

    def test_flagged_payment_holds_no_money_until_reviewed(self, api, rich):
        payment = self.flagged(api, rich)
        assert self.balance(api, rich[0]) == 50_000_000
        queue = api.get("/api/v1/fraud/review-queue").json()
        assert queue["count"] == 1 and queue["results"][0]["payment"]["id"] == payment["id"]

    def test_approving_completes_the_payment(self, api, rich):
        payment = self.flagged(api, rich)
        response = api.post(f"/api/v1/fraud/review/{payment['id']}/resolve", {"decision": "approve"}, format="json")
        assert response.status_code == 200 and response.json()["status"] == "captured"
        assert self.balance(api, rich[1]) == 600_000
        assert api.get("/api/v1/fraud/review-queue").json()["count"] == 0

    def test_rejecting_fails_the_payment(self, api, rich):
        payment = self.flagged(api, rich)
        response = api.post(
            f"/api/v1/fraud/review/{payment['id']}/resolve",
            {"decision": "reject", "note": "stolen card"},
            format="json",
        )
        assert response.json()["status"] == "failed" and response.json()["failure_reason"] == "fraud_rejected"
        assert self.balance(api, rich[0]) == 50_000_000

    def test_a_review_can_only_be_resolved_once(self, api, rich):
        payment = self.flagged(api, rich)
        url = f"/api/v1/fraud/review/{payment['id']}/resolve"
        assert api.post(url, {"decision": "approve"}, format="json").status_code == 200
        assert api.post(url, {"decision": "reject"}, format="json").status_code == 409

    def test_blocked_payment_never_touches_money(self, api, rich):
        customer, merchant = rich
        for _ in range(9):
            pay(api, customer, merchant, 100)
        blocked = pay(api, customer, merchant, 100)
        assert blocked.status_code == 402 and blocked.json()["failure_reason"] == "fraud_blocked"
        approved = Payment.objects.filter(status="captured").count()  # payments 5-9 were held for review
        assert approved == 4
        assert self.balance(api, customer) == 50_000_000 - approved * 100


class TestModel:
    @pytest.fixture(scope="class")
    @classmethod
    def rows(cls):
        with gzip.open(SAMPLE, "rt") as handle:
            return list(csv.DictReader(handle))

    def score(self, model, row):
        signals = [float(row[f"V{i}"]) for i in range(1, 29)]
        return model.predict_proba(signals, round(float(row["Amount"]) * 100))

    def test_artifact_loads_and_carries_its_evaluation(self):
        model = load_model()
        assert model is not None and len(model.coef) == 29
        assert 0 < model.review_threshold < model.block_threshold < 1
        assert model.metrics["test_frauds"] > 0

    def test_separates_real_fraud_from_real_legitimate_transactions(self, rows):
        model = load_model()
        fraud = [self.score(model, r) for r in rows if r["Class"] == "1"]
        legit = [self.score(model, r) for r in rows if r["Class"] == "0"]
        flagged_fraud = sum(s >= model.review_threshold for s in fraud) / len(fraud)
        flagged_legit = sum(s >= model.review_threshold for s in legit) / len(legit)
        assert flagged_fraud > 0.7  # recall on the held-out frauds
        assert flagged_legit < 0.02  # false-positive rate on legitimate traffic
        assert sum(fraud) / len(fraud) > 20 * sum(legit) / len(legit)

    def test_scores_through_the_api_end_to_end(self, api, rich, rows):
        model = load_model()
        fraud_row = max((r for r in rows if r["Class"] == "1"), key=lambda r: self.score(model, r))
        legit_row = next(r for r in rows if r["Class"] == "0")

        def send(row):
            signals = [float(row[f"V{i}"]) for i in range(1, 29)]
            return api.post(
                "/api/v1/payments",
                {
                    "payer_id": str(rich[0].id),
                    "payee_id": str(rich[1].id),
                    "amount": max(100, round(float(row["Amount"]) * 100)),
                    "risk_signals": signals,
                },
                format="json",
                HTTP_IDEMPOTENCY_KEY=new_key(),
            )

        bad, good = send(fraud_row), send(legit_row)
        assert bad.json()["fraud_decision"] in {"review", "block"}
        assert good.json()["fraud_decision"] == "approve"
        assert bad.json()["fraud"]["model_score"] > good.json()["fraud"]["model_score"]

    def test_assessment_without_signals_skips_the_model(self, rich):
        result = assess(payer=rich[0], amount=1_000, risk_signals=None)
        assert result.model_score is None and result.decision == "approve"

    def test_wrong_signal_count_is_rejected_by_the_model(self):
        with pytest.raises(ValueError):
            load_model().predict_proba([0.0] * 5, 100)
