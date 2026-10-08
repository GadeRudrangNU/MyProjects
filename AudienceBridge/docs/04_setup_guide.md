# Setup and test guide

Work top to bottom. Parts 1 to 4 are required. Parts 5 to 8 are optional extras.

## Part 1. Google Cloud and BigQuery Sandbox (about 15 minutes)

### 1.1 Create the project
1. Go to https://console.cloud.google.com and sign in with your Google account.
2. Accept the terms if asked. **Do not start a free trial and do not add a credit card.**
3. Click the project picker at the top left, then **New Project**.
4. Name it `audiencebridge` and click **Create**.
5. Open the project picker again and copy the **Project ID** (for example `audiencebridge-123456`). The ID is not the same as the name. You need the ID.

### 1.2 Open BigQuery in sandbox mode
1. Go to https://console.cloud.google.com/bigquery with your new project selected.
2. You should see a banner saying you are using the sandbox. If you are asked to enable the sandbox, accept. **If you ever see "Upgrade", ignore it.** Upgrading means billing.
3. Check that the public data is reachable. Click **SQL query** and run:

```sql
SELECT COUNT(*) AS events
FROM `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
```

You should get a few million rows. If this works, the source data and your sandbox are fine.

Everything this project creates goes in the **US** location, the same as the public data. The code does this for you.

### 1.3 Install and log in with the gcloud CLI
gcloud is already installed on your machine. In PowerShell:

```powershell
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud auth application-default login
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
```

Each `login` opens a browser. Choose the same Google account you used in 1.1. The `application-default` login is the one the Python code uses, so you do not need a service account or a key file for local runs.

Check it worked:

```powershell
gcloud config get-value project
```

## Part 2. Local setup (about 5 minutes)

In PowerShell, from the project folder:

```powershell
cd C:\Users\rudra\Desktop\product\AudienceBridge
.\.venv\Scripts\Activate.ps1
copy .env.example .env
notepad .env
```

In `.env` set only these two lines (ignore the Google Ads lines for now):

```
GCP_PROJECT=YOUR_PROJECT_ID
BQ_LOCATION=US
```

If PowerShell refuses to run `Activate.ps1`, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or skip activation and call `.\.venv\Scripts\python.exe` instead of `python`.

Run the offline tests first. These need no cloud access:

```powershell
python -m pytest -q
python -m audiencebridge validate-config
```

Expected: `86 passed` and `OK: gmerch_store, 6 segments`.

## Part 3. Run the pipeline step by step (about 20 minutes)

Run the steps one at a time the first time, so you can see what each one does. After each step, open BigQuery in the browser, refresh the Explorer panel, and look at the tables listed.

| # | Command | What to check in BigQuery |
|---|---|---|
| 1 | `python -m audiencebridge init` | Five datasets exist: `ab_raw`, `ab_staging`, `ab_marts`, `ab_activation`, `ab_measurement` |
| 2 | `python -m audiencebridge build` | `ab_staging.stg_ga4_events` (millions of rows), `ab_marts.user_features` (one row per user), `ab_marts.future_outcomes` |
| 3 | `python -m audiencebridge crm` | `ab_raw.crm_customers` (tens of thousands of rows) |
| 4 | `python -m audiencebridge propensity` | `ab_marts.purchase_propensity` model, `propensity_scores`, `ab_measurement.model_evaluation` |
| 5 | `python -m audiencebridge segments` | `ab_marts.segments` and `segment_members` |
| 6 | `python -m audiencebridge privacy` | `ab_raw.crm_normalized`, `ab_activation.activation_ready`, `audience_summary` |
| 7 | `python -m audiencebridge measure` | `ab_measurement.segment_backtest`, `aa_test_results`, `dashboard_summary` |
| 8 | `python -m audiencebridge check` | Prints every check as `ok`. Any `FAILED` stops the run |
| 9 | `python -m audiencebridge activate` | Dry run. Files appear in `activation_payloads/`; rows appear in `ab_activation.activation_log` |
| 10 | `python -m audiencebridge audit` | `reports/data_audit.md` |
| 11 | `python -m audiencebridge readout` | `reports/readout_2020-12-31.md` |

Once it works, the whole thing is one command:

```powershell
python -m audiencebridge run-all
```

### If a step fails
- **Permission or "not found" errors:** confirm `gcloud config get-value project` matches `.env`, and that you ran the `application-default` login.
- **Location error mentioning US:** set `BQ_LOCATION=US` in `.env`.
- **Model step fails:** it falls back to scikit-learn on its own and logs a warning. That is fine.
- **Anything else:** run the failing step with `-v` for a full traceback, for example `python -m audiencebridge segments -v`, and fix from there. Rules in the YAML are checked before any SQL runs, so a bad rule fails fast with a clear message.

## Part 4. What to test and what good looks like

Run these queries in the BigQuery console (replace `PROJECT` with your project ID).

**1. Audience sizes and where users drop out**

```sql
SELECT segment_name, segment_size, matched_size, consented_size,
       valid_id_size, holdout_size, activatable_size, meets_min
FROM `PROJECT.ab_activation.audience_summary`
ORDER BY segment_size DESC
```

Sizes should shrink left to right: behaviour, then CRM match, then consent, then valid identifier, then holdout. `meets_min` is true when `activatable_size` is at least 100.

**2. Do the audiences actually predict purchases? (the backtest)**

```sql
SELECT segment_name, users, purchase_rate, baseline_rate, lift_index, p_value, evaluated_on
FROM `PROJECT.ab_measurement.segment_backtest`
ORDER BY lift_index DESC
```

A good audience has `lift_index` well above 1 and a small `p_value`. Cart abandoners, high-value buyers and the propensity segment should beat the baseline. Report whatever you get. Do not tune rules until the numbers look nice; that would be cheating the backtest.

**3. Is the holdout design sound? (A/A test)**

```sql
SELECT segment_name, n_treatment, n_holdout, rate_treatment, rate_holdout, p_value, passes
FROM `PROJECT.ab_measurement.aa_test_results`
```

`passes` should be true everywhere. No ads ran, so treated and holdout users should behave the same. A false here means something is wrong with the split.

**4. Model quality**

```sql
SELECT * FROM `PROJECT.ab_measurement.model_evaluation`
```

`roc_auc` above 0.5 means it beats chance; 0.7 or higher is a good result.

**5. Privacy checks (prove it for yourself)**

```sql
-- should return 0 rows: nothing readable
SELECT * FROM `PROJECT.ab_activation.activation_ready`
WHERE hashed_email LIKE '%@%' OR LENGTH(hashed_email) != 64;

-- should be 0: no non-consenting user was activated
SELECT COUNT(*) FROM `PROJECT.ab_activation.activation_ready` a
JOIN (SELECT TO_HEX(SHA256(email_n)) h FROM `PROJECT.ab_raw.crm_normalized`
      WHERE NOT consent_ok AND email_n IS NOT NULL) n ON a.hashed_email = n.h;
```

Look at `ab_raw.crm_customers` (messy raw values) next to `ab_raw.crm_normalized` (cleaned) to see the normalisation working: uppercase emails, padded spaces, dotted gmail addresses, malformed phones.

**6. Payloads**

Open any file in `activation_payloads/`. It should contain only 64-character hex strings, region and postal code, and `CONSENT_GRANTED`. Check `ab_activation.activation_log`: status `dry_run_ok` for each request.

**7. Readout**

Open `reports/readout_2020-12-31.md`. Every number should match the tables above.

**8. Break it on purpose (shows the guard rails work)**
- Set `min_audience_size: 100000` in the YAML, rerun `segments`, `privacy`, `measure`, `activate`. Every segment should be skipped with a reason.
- Add a segment with the rule `secret_column = 1`. `validate-config` should reject it.
- Rerun `run-all`. It should finish with the same results, because every table is rebuilt (idempotent).

## Part 5. Save your work to GitHub

1. Create a new **public** repository on https://github.com/new (public repos get free Actions minutes). Do not add a README there.
2. In PowerShell:

```powershell
git add -A
git status
git commit -m "Add audience pipeline"
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

`git status` before committing should not list `.env`, `.venv`, `reports/` content or any `*.json` key. They are git-ignored. If you see one, stop and tell me.

## Part 6. Scheduled pipeline on GitHub Actions

1. In the Cloud console go to **IAM & Admin, Service Accounts, Create service account**. Name it `audiencebridge-runner`.
2. Grant it the roles **BigQuery Data Editor** and **BigQuery Job User**, then finish.
3. Open the account, **Keys, Add key, Create new key, JSON**. A file downloads. If key creation is blocked by an organisation policy, use Workload Identity Federation instead (see the comment in `.github/workflows/pipeline.yml`).
4. In your GitHub repo go to **Settings, Secrets and variables, Actions, New repository secret**. Add:
   - `GCP_PROJECT` = your project ID
   - `GCP_SA_KEY` = the full contents of the JSON file
5. Delete the downloaded JSON from your machine, or keep it outside the project folder.
6. Open the **Actions** tab, choose **pipeline**, **Run workflow**. A green run means the weekly schedule will work. A failed run opens a GitHub issue automatically.

## Part 7. Looker Studio dashboard (optional)

1. Go to https://lookerstudio.google.com and click **Create, Report**.
2. Pick the **BigQuery** connector, then **My Projects**, your project, `ab_measurement`, `dashboard_summary`. Click **Add**.
3. Add charts: a bar chart of `segment_size`, `consented_size` and `activatable_size` by `segment_name`; a bar chart of `lift_index`; a table with `aa_passes`. Add `ab_activation.activation_log` as a second source for run history.
4. Leave data freshness at the default so it does not hammer your query quota.

## Part 8. Streamlit console (optional)

Local:

```powershell
pip install streamlit
streamlit run app/streamlit_app.py
```

It uses the same gcloud login as the pipeline. Check each page: Segments, Activation, Measurement, Readout.

Hosted:
1. Create a second service account with only **BigQuery Data Viewer** and **BigQuery Job User**, and a JSON key for it.
2. Go to https://share.streamlit.io, sign in with GitHub, **New app**, choose your repo, main file `app/streamlit_app.py`.
3. In **Advanced settings, Secrets** paste the format from `.streamlit/secrets.toml.example`, filled from the JSON key.

## Part 9. Google Ads test account (optional, only for live calls)

You do not need this to have a complete working prototype.

1. Create a Google Ads **manager account** from https://ads.google.com/home/tools/manager-accounts/. Do not enter billing.
2. In the manager account open **Tools, API Center** and apply for a **developer token**. It starts at test access, which is enough.
3. Create a **test manager account** and a **test client account** under it (search Google's docs for "Google Ads test accounts" for the current steps).
4. In the Cloud console go to **APIs & Services, Credentials, Create credentials, OAuth client ID**, type Desktop app. Enable the **Google Ads API** for the project.
5. Generate a refresh token with the authentication example in Google's `google-ads-python` repository.
6. Fill the `GOOGLE_ADS_*` values in `.env`, then:

```powershell
pip install -r requirements-ads.txt
python -m audiencebridge campaigns --live
```

It creates a paused campaign structure and prints what it read back. Nothing serves or spends in a test account.

For Customer Match uploads, create the user lists, put their IDs in the YAML under `activation.user_lists`, and run `python -m audiencebridge activate --live --validate-only` before any real upload.

## Part 10. Things to know
- **Sandbox tables expire after 60 days.** Just rerun `run-all`.
- **Query quota is 1 TB a month.** One full run uses a small fraction. Avoid refreshing dashboards constantly.
- **Never commit** `.env`, key files or `google-ads.yaml`.
- **What the results prove:** the backtest shows which audiences predict purchases. It does not prove ad lift. That needs a live flight against the holdout.
