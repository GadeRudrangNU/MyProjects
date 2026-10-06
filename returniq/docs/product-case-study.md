# ReturnIQ — Product Case Study

> **Reading guide.** Anything marked **MEASURED** is computed from the UCI Online Retail II dataset by code in this repo (regenerate with `make pipeline`). Anything marked **PROPOSED** is a design or an assumption that has not been run or observed.

## 1. Problem

E-commerce teams lose margin to returns and cancellations, but their dashboards describe returns after they have happened. By then the refund is issued and the stock is in the wrong place. The question worth a product team's time is forward-looking: *which purchases are likely to come back, why, and is intervening worth it?*

## 2. User

* **Merchandiser / category manager** — owns product assortment and listing quality.
* **E-commerce / product manager** — owns checkout and post-purchase flows; decides which interventions to build.
* **Operations / customer-care lead** — owns the manual review and outreach queue.

## 3. Jobs-to-be-Done

* *When* I review last week's trading, *I want to* see which products create disproportionate credit/return behaviour *so I can* fix listings or supplier quality first.
* *When* an order is placed, *I want to* know whether it is high-risk and why *so I can* decide whether a light-touch intervention is worth its cost.
* *When* I propose an intervention, *I want to* estimate its net benefit and design the test *so I can* get it prioritised with evidence.

## 4. Existing workflow

(Inferred from common practice — no user interviews were conducted for this prototype.) Weekly BI reports of return rate by category; ad-hoc spreadsheet pulls; intervention ideas argued on intuition; A/B tests sized by rule of thumb.

## 5. Pain points

* Backward-looking: no order-level foresight.
* Rates by category hide the few products and customers that drive the loss.
* No bridge from "this is risky" to "this is worth acting on" (cost, conversion risk, expected benefit).
* Models are black boxes, so ops teams do not trust them.

## 6. Product hypothesis

An explainable, calibrated risk score at purchase time, paired with a simulator and a ready experiment design, lets a PM choose a worthwhile intervention and test it with guardrails — **Predict → Explain → Intervene → Measure**. *(PROPOSED: not validated with users or in production.)*

## 7. MVP scope

**In:** real public data; honest target; leak-free model; per-order SHAP explanation; risk explorer; product quadrant; simulator with labelled assumptions; experiment design; limitations page.
**Out (deliberately):** authentication, live ingestion, order-level model, size guidance (no size data), reason analysis (no reason data), automated actions.

## 8. Prioritisation

| Item | Value | Effort | Decision |
|---|---|---|---|
| Honest target + leakage controls | Critical (credibility) | M | Build first |
| Explainable score + explorer | High (trust, daily use) | M | Build |
| Product quadrant | High (fast PM insight) | S | Build |
| Intervention simulator | High (decision support) | S | Build |
| Experiment design page | Medium–High (measurement) | S | Build |
| Order-level model, uplift modelling, auth | Medium | L | Later |

## 9. User journey

1. Open the dashboard → see observed credit rate and expected value at risk in the open window.
2. Product intelligence → spot high-volume, high-rate products → click through to their high-risk lines.
3. Risk explorer → open a high-risk line → read the SHAP drivers (e.g. product's history, line value, customer's history).
4. Simulator → set the top-X% to target and the assumptions → check net benefit and break-even effectiveness.
5. Experiment page → size the A/B test and confirm guardrails before building anything.

## 10. Success metrics

**PROPOSED production metrics (not measured here)**
* Primary: *30-day retained purchase rate* (treated vs. control).
* Guardrails: checkout conversion, checkout completion, AOV, pre-shipment cancellation rate.
* Operational: intervention coverage, precision among top-risk orders, cost per prevented return.

**MEASURED observed proxies in this dataset** (credit notes, heuristic matching): 84.61% of orders and 98.41% of purchase lines had no credit note within 30 days.

## 11. Experiment design (PROPOSED — never run)

* **Hypothesis:** for orders in ReturnIQ's High tier, a low-friction intervention lowers the 30-day credit rate without hurting conversion.
* **Unit / exposure:** orders with ≥1 High-tier line at checkout; 50/50 randomisation.
* **Control / treatment:** normal experience / normal + intervention.
* **Primary metric:** 30-day retained purchase rate. **Guardrails:** conversion, checkout completion, AOV, cancellation rate.
* **Sample size:** two-proportion z-test; the app's calculator uses the observed High-tier credit rate (7.00% on the held-out period) as the baseline and an assumed minimum detectable effect.
* **Decision rule:** ship only if the primary improves (two-sided α) and every guardrail stays within its pre-registered margin; run the full planned duration.

## 12. Technical approach

* Public data → cleaning → heuristic matching of credit notes to purchases → 30-day label.
* 23 point-in-time features; chronological split with a 30-day purge gap.
* Four candidate models plus a one-feature heuristic; selection by validation PR-AUC; sigmoid calibration; exact TreeSHAP.
* FastAPI + SQLAlchemy + SQLite; React + TypeScript + Recharts front end; everything free and local.

## 13. Results

**MEASURED** (held-out test period, 2011-07-31 → 2011-11-09; 131,932 purchase lines, 2,063 positives, 1.56% base rate)

| | |
|---|---|
| ROC-AUC | **0.770** |
| PR-AUC | **0.063** (random ≈ 0.016) |
| Flag top 10% of lines | precision 6.3% (4.0× lift), captures 40.3% of credited lines |
| Flag top 1% of lines | precision 12.4% (7.9× lift) |
| High tier (7.6% of lines) | 7.00% observed credit rate vs. 0.78% in the Low tier |
| Brier score | 0.0150 after calibration |
| Label coverage | 91.0% of credit-note rows and 97.0% of credited units matched to a purchase; 11,321 positives of 712,562 labelled lines (1.59%) |

Other measured findings:
* Product history is the dominant signal; a one-line "product's historical credit rate" rule scores 0.685 test ROC-AUC against 0.770 for the model.
* Logistic regression (0.784 test ROC-AUC) ranked slightly better than the selected random forest on test, even though the forest won validation — evidence of period-to-period shift. The selection rule was not changed after seeing test.
* On the held-out period the value-at-risk formula expected £52.6k of credited value; £73.1k was actually credited. The score underestimates value because credited lines skew toward larger values.
* Simulator backtest (top 5% targeted): 8.0% of targeted lines were actually credited vs 1.6% overall, and the slice held 28% of all credited value.

**Not measured:** any effect of an intervention, any revenue impact, any conversion effect. The simulator and experiment page are projections and designs.

## 14. Limitations

The target is a credit note, not a confirmed return; matching to purchases is heuristic; ~22% of purchase rows lack a customer ID; this is wholesale, UK-centric gift-ware without size, category, reason, exchange or margin data; the signal is modest (ranking is useful, point predictions are not); the final 30 days are unlabelled. See the in-app **Data & model limitations** page.

## 15. What I would build next

1. Order-level model and rolling-origin backtests with calibration-drift monitoring.
2. A richer dataset with return reasons and sizes (e.g. fashion retail) to enable sizing guidance.
3. Run a pilot on a real storefront to replace the placeholder effectiveness/cost assumptions with measured values.
4. Uplift modelling to target persuadable orders, not just risky ones.
5. User interviews with merchandisers and ops leads to validate the jobs and pain points inferred above.
