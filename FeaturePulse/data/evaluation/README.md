# Evaluation workflow

> **Evaluation pending.** The repository ships with an unlabeled sample, so it reports **no** precision, recall or F1 for
> theme assignment. `reports/evaluation_metrics.json` says `"status": "pending"` until the sample below is labeled.
> Nothing in this repository estimates, simulates or back-fills those numbers.

## Why a human labels the data

The dataset has no theme labels (it only has star ratings, dates and app names), so there is no ground truth for "is this
feedback in the right theme?" except a person's judgment. The labeling sample exists to produce a *defensible* statement of the form
"precision = X% on N manually labeled records", with a confidence interval.

## How to label (about 30–45 minutes for 150 rows)

```bash
python scripts/create_labeling_sample.py --n 150      # writes data/evaluation/labeling_sample.csv (random, seeded sample)
```

Open the CSV in Excel / Sheets and fill two columns per row:

| column | what to enter |
|---|---|
| `correct_cluster` | `1` if the **predicted theme** (see `predicted_theme` + `theme_keywords`) fairly describes the main topic of the feedback, else `0`. Judge the *topic*, not the sentiment. |
| `human_theme` | A short free-text label (2–4 words) of what the feedback is actually about, e.g. `photo upload`, `battery drain`. **Reuse the exact same wording** for the same topic; this enables the clustering-agreement metrics. |

Rules of thumb: label what the user is complaining/asking about; if the review is too vague to assign to any topic, mark `0`
and use `human_theme = unclear`. Do not look at other rows' predictions to "calibrate" — label independently.

Then compute metrics:

```bash
python scripts/evaluate_labels.py                     # writes reports/evaluation_metrics.json
```

## Metrics produced

| metric | definition |
|---|---|
| `n_labeled` | rows with `correct_cluster` ∈ {0,1} |
| `precision` | correct / labeled — share of assignments a human judged right (+ Wilson 95% interval) |
| `adjusted_rand_index`, `normalized_mutual_info`, `homogeneity`, `completeness` | agreement between model themes and your `human_theme` grouping |
| `pairwise_precision / recall / f1` | for every pair of labeled rows: does the model agree with you on "same theme vs. different theme"? (`recall` and `f1` are these pairwise values) |

Caveats built into the script: it warns when fewer than 100 rows are labeled; agreement metrics need ≥ 20 rows with `human_theme`;
with ~150 rows spread over ~60 themes the pairwise statistics are noisy — report the interval, not just the point estimate.

> **Reading `recall` / `f1`:** these are pair-counting statistics against *your* grouping. If your `human_theme` labels are much broader than the
> model's ~80 themes (e.g. 20 categories), recall is low by construction, because two reviews in your "crash" group will naturally sit in
> different model themes. Lead with `precision` (+ interval) and `homogeneity`; treat pairwise recall/F1 as secondary.

## What is *not* human evaluation

* `reports/clustering_evaluation.json` – intrinsic, unsupervised cluster-quality metrics (silhouette, stability, …).
* `reports/sentiment_evaluation.json` – agreement of sentiment models with the dataset's **star ratings** (a proxy supplied by the
  dataset, not a label created for FeaturePulse).

These are useful engineering evidence but are never presented as theme-assignment precision.

`labeling_sample.csv` is git-ignored by default (it is your working file). Commit your labeled copy deliberately if you want the
evaluation to be reproducible by others.
