# Data

FeaturePulse analyzes **real, public app-store reviews**. Nothing in the seeded corpus is invented.

## Source

| | |
|---|---|
| Dataset | **AppReviews** (`sealuzh/app_reviews` on Hugging Face) |
| URL | https://huggingface.co/datasets/sealuzh/app_reviews |
| Origin | Grano, Di Sorbo, Mercaldo, Visaggio, Canfora, Panichella, *"Android apps and user feedback: a dataset for software evolution and quality improvement"*, WAMA 2017 — reviews of ~400 open-source Android apps from the F-Droid repository, extracted from Google Play |
| Raw size | **288,065** reviews, 395 distinct apps |
| Raw fields | `package_name` (app), `review` (text), `date` (e.g. "October 12 2016"), `star` (1–5) |
| Date range | 2014-01-01 → 2017-05-02 |
| Reproducible download | `python scripts/prepare_data.py` downloads the parquet file straight from Hugging Face (≈13 MB) |

## License / usage considerations — read before redistributing

The dataset card lists the license as **`unknown`**. The reviews are public user-generated text originally published on Google Play and were
released by the authors for research. Because no explicit license grants redistribution:

* **This repository does not contain the dataset or any derived review text.** `data/raw/`, `data/processed/` and the database
  are git-ignored; every user downloads the data themselves with the script above.
* Screenshots in the README show a small number of review excerpts for demonstration; they are not a redistribution of the corpus.
* If you build on this project commercially, check Google Play's terms and contact the dataset authors first.
* Reviews can contain personal remarks; the pipeline strips URLs and e-mail addresses, but no other anonymization is applied.

## Mapping to the FeaturePulse schema

| FeaturePulse field | From dataset | Notes |
|---|---|---|
| `text` | `review` | cleaned (URLs/e-mails removed, repeated characters squeezed) |
| `created_at` | `date` | parsed with `%B %d %Y`; no unparseable dates |
| `rating` | `star` | 1–5 |
| `product_area` | `package_name` | the app the review belongs to |
| `source` | constant `app_review` | the dataset has one source type |
| `customer_segment` | — | **unknown (NULL)** — not in the dataset, never invented |
| `sentiment`, `sentiment_label` | derived | VADER blended with the star rating (30% weight) |
| `severity`, `severity_score`, `severity_signals` | derived | transparent rule engine (`ml/severity.py`) |
| `theme_id` | derived | stored in `feedback_theme_mapping` |
| `synthetic` | `false` for every record | |

## Cleaning (exact counts from `reports/data_preparation.json`)

| Step | Records |
|---|---:|
| Raw reviews | 288,065 |
| Unparseable dates dropped | 0 |
| Empty after cleaning | 12 |
| Too short / not enough text (< 5 words or < 20 characters, or mostly non-letters) | 139,442 |
| Non-English (ASCII ratio + English function-word heuristic) | 5,835 |
| Exact duplicates consolidated (same normalized text; earliest kept, count stored in `metadata.duplicate_count`) | 2,622 |
| **Clean reviews** | **140,154** |
| Per-app cap of 600 random reviews (seed 42) so one app (Google Play Services alone has >100k reviews) cannot dominate the themes | −74,485 |
| **Analyzed corpus** | **65,669** across 395 apps |

## Limitations

* **Short reviews dominate the raw data** ("great app", "nice"): nearly half of the corpus was dropped as uninformative. Themes therefore describe *substantive* feedback only.
* **Per-app capping changes proportions.** Theme volumes reflect the sample, not the true market share of each app or issue. The cap protects theme discovery from a single huge app, but it distorts absolute counts.
* **Dates end in 2017-05**, and review volume in the dataset surges in late 2016 (a property of how the authors collected reviews). The Emerging Issues page therefore compares the *latest window of the dataset* with earlier windows, not "today".
* **No customer segments, no revenue, no user IDs.** FeaturePulse therefore scores *customer impact* as negative mentions (unhappy reviewers reached), and has no business/revenue component.
* **Ratings are noisy:** some 5-star reviews describe bugs and some 1-star reviews are praise. Ratings are only a weak signal in sentiment (30% weight).
* **Open-source Android apps** are not representative of every B2B product; the *method* is what transfers, and the CSV upload lets you run it on your own feedback.
* English-only heuristic; no language detection model is used.

## Synthetic data

None. The seeded corpus is 100% real. (The test-suite builds a tiny labeled-synthetic fixture; those rows carry `synthetic = true`, live only in a throwaway test database and are never part of any evaluation.)
