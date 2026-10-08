# Runbook

## Run it

```bash
python -m audiencebridge run-all            # full dry-run pipeline
python -m audiencebridge run-all --regen-crm  # also rebuild the synthetic CRM
```

Outputs: BigQuery datasets `ab_raw`, `ab_staging`, `ab_marts`, `ab_activation`, `ab_measurement`; local `reports/` and `activation_payloads/`.

Scheduled: `.github/workflows/pipeline.yml` runs Mondays 06:00 UTC and on demand. Required repository secrets: `GCP_PROJECT`, `GCP_SA_KEY` (service account JSON with BigQuery Data Editor and Job User). A failed run opens a GitHub issue.

## Add a segment

Edit `config/clients/<client>.yaml`:

```yaml
- name: mobile_cart_abandoners
  objective: re-engage
  rule: device_category = 'mobile' AND add_to_carts > 0 AND purchases = 0
  membership_days: 30
```

Rules are SQL boolean expressions over: `first_seen, last_seen, sessions, item_views, add_to_carts, purchases, revenue_usd, last_cart_date, last_purchase_date, apparel_views, days_since_last_seen, device_category, country, propensity_score`. Parameters: `@as_of` and `@pNN_<numeric column>` (the NN-th percentile among rows where the column is above zero). Check it with `python -m audiencebridge validate-config`, then `python -m audiencebridge segments`.

## Add a client

Copy the YAML, change `client`, dates, thresholds and segments, then run with `CLIENT_CONFIG=config/clients/<new>.yaml`. Source SQL lives in `sql/staging/stg_ga4_events.sql`; point it at the new client's GA4 export if it is not the public sample.

## Go live

1. Create the Customer Match lists in the Google Ads test account and add their IDs under `activation.user_lists`.
2. `python -m audiencebridge activate --live --validate-only`. Fix anything reported in `ab_activation.activation_log`.
3. `python -m audiencebridge activate --live`.
4. `python -m audiencebridge campaigns --live` for the paused campaign structure.

## Common failures

| Symptom | Cause and fix |
|---|---|
| `GCP_PROJECT is not set` | Create `.env` from `.env.example`. |
| `Not found: Dataset bigquery-public-data...` or location error | Datasets must be in the `US` location, the same as the public data. Set `BQ_LOCATION=US`. |
| BigQuery ML error | Falls back to scikit-learn automatically. Force it with `propensity.backend: sklearn`. |
| `@p90_... could not be computed` | The column has no values above zero. Check the upstream table. |
| Segment below minimum size | See `ab_activation.audience_summary` for where users drop out (no CRM match, no consent, invalid identifier, holdout). Raise `other_match_rate` in the YAML or widen the rule. |
| Data-quality check failed | The run stops. The failing check name says which invariant broke; fix the cause and rerun. |
| Tables disappeared after 60 days | Sandbox expiry. Rerun the pipeline; it rebuilds everything. |
| `invalid` rows in `activation_log` | Payload validation failed; read the `error` column. |

## Privacy handling

- `ab_raw` holds the only plaintext identifiers (`crm_customers`, `crm_normalized`). Restrict it to the pipeline's service account.
- `ab_activation.activation_ready` holds SHA-256 hashes plus region and postal code (which the API takes unhashed) and no user IDs.
- The weekly workflow runs on synthetic data only.
- Never commit key files, `.env`, or `google-ads.yaml`; they are git-ignored.
