# Resume bullets

Every figure comes from `reports/model_metrics.json` or the pipeline output. No impact on returns, revenue or conversion is claimed because none was measured.

**ReturnIQ: Product Intelligence for Reducing E-Commerce Returns** | Python, scikit-learn, SHAP, SQL/SQLite, FastAPI, React, TypeScript

• Built an end-to-end return-risk product on 1.07M real UCI Online Retail II transactions: defined an honest 30-day credit-note target by matching credit notes to purchases (91% of credit-note rows matched), engineered 23 point-in-time features, and used chronological splits with a purge gap to prevent leakage.

• Compared logistic regression, random forest, gradient boosting and XGBoost with a pre-set selection rule; the selected model reached 0.77 ROC-AUC and 0.063 PR-AUC (vs. 0.016 base rate) on 131,932 held-out purchase lines, with 4.0× lift and 40% of credited lines captured in the top 10% of risk; added exact SHAP explanations and calibration.

• Designed and shipped a React/FastAPI decision tool with a risk explorer, product-priority quadrant, an intervention simulator with labelled assumptions and backtest check, and an A/B experiment design with guardrail metrics and sample-size methodology; covered by 28 pytest and 3 vitest tests.
