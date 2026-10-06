# FeaturePulse — Product Case Study

*From 65,669 fragments of customer feedback to a defensible roadmap decision.*

> **How to read this document.** Sections 1–6 describe a problem I identified from product-management practice and public material; **I did not run user interviews**, so the persona and pain points are *hypotheses*, labeled as such. Sections 8–16 describe what I built and the evidence it produced. Every number in this document comes from the running system (`reports/`); where something has not been measured, it says so.

---

## 1. Problem discovery

Product teams don't suffer from a shortage of feedback; they suffer from **fragmentation**. Input arrives from app-store reviews, support tickets, NPS comments, interviews, sales calls and community posts — each in different words, formats and volumes. The same underlying issue is described dozens of ways:

> “App freezes when I upload photos.” · “Uploading an image crashes everything.” · “Can't attach pictures.” · “Photo upload stopped working.”

Two failure modes follow:

1. **Loudest-voice prioritization** – the issue that was most recently, most eloquently or most senior-ly raised wins.
2. **Reading a sample** – a PM skims 50 reviews, picks a story and misses the 800 that said the same thing differently.

The question I set out to answer: **How can a PM turn thousands of fragments of feedback into defensible roadmap decisions?** — *defensible* being the operative word: a PM has to explain a prioritization to engineering, design and leadership.

## 2. Target persona (hypothesis)

**“Maya”, Product Manager (or APM) for a consumer or prosumer mobile/web product.** Owns a quarterly roadmap, has one data analyst shared across three teams, no budget for a dedicated insights tool, and gets asked “why this and not that?” in every planning review.

Secondary: a **Technical PM / AI PM** who wants to understand how the clustering works well enough to trust — and challenge — it.

## 3. Jobs-to-be-Done

* *When* planning next quarter, *I want to* see what customers are struggling with, grouped by underlying problem, *so I can* choose what to fix first with evidence.
* *When* a release ships, *I want to* know quickly if a problem is emerging, *so I can* react before it becomes a crisis.
* *When* leadership challenges a priority, *I want to* show exactly why it ranked where it did, *so I can* defend or change it.
* *When* the AI gets something wrong, *I want to* correct it once and have the correction remembered.

## 4. Existing workflow (hypothesis)

Export reviews/tickets to a spreadsheet → filter by keyword → skim → hand-tag a sample → paste representative quotes into a deck → argue about priority using a gut-feel scoring sheet. Repeat each quarter; nothing carries over.

## 5. Pain points (hypotheses)

| Pain | Consequence |
|---|---|
| Paraphrases defeat keyword search | Real volume of an issue is undercounted |
| Tagging by hand doesn't scale | Teams tag a sample and extrapolate |
| No notion of *change* | Emerging problems are noticed late, via escalation |
| Scoring is opaque | Prioritization debates become opinion contests |
| AI tools that “summarize” hide the evidence | Low trust → not used for decisions |
| Corrections are lost | The tool keeps making the same mistake |

## 6. Product hypothesis

> If a PM can see **semantic themes** with volume, severity and trend, **re-weight the scoring model themselves**, and **override anything the AI proposes**, then they will make roadmap decisions faster and with evidence they can defend — and they will trust the tool because it never asks them to trust it blindly.

Design principle that follows: *AI proposes, the PM decides.* Not “AI summarizes feedback”.

## 7. Competitive alternatives

| Alternative | Strength | Gap FeaturePulse targets |
|---|---|---|
| Spreadsheets + manual tags | Total control, free | Doesn't scale; no semantic grouping; no trend signal |
| Feedback-ops suites (e.g. Productboard, Canny, Dovetail, Enterpret, Thematic) | Integrations, collaboration, polish | Typically paid, hosted, and a general workflow; this project is a free, local, inspectable reference implementation. *(I have not benchmarked these products; this row reflects public positioning, not testing.)* |
| “Paste it into an LLM” | Fast summaries | No quantification, no trend, not reproducible, data leaves the building, can't be audited |
| Keyword dashboards | Easy | Miss paraphrases; no theme concept |

The project's differentiation is **not** “better AI”; it is **a decision workflow whose AI parts are transparent, local and overridable**.

## 8. MVP definition

In scope (built): ingest public data and CSVs → local embeddings → semantic themes with keyword labels → sentiment and explainable severity → trend detection → adjustable, explainable priority score → roadmap buckets with rationale → PM overrides that persist → honest evaluation workflow.

Out of scope (deliberately): connectors to Zendesk/App Store/Intercom, multi-user auth, revenue weighting (no data), online model retraining, LLM-generated summaries.

**MVP test:** can one PM go from raw feedback to a roadmap decision with written rationale **inside one tool, with every number traceable?** Yes — the workflow is Customer signal → Insight → Priority → Decision → Roadmap.

## 9. Prioritization (of the product itself)

Feature choices were made by asking “does this change a PM decision?”

| Feature | Decision it supports | Verdict |
|---|---|---|
| Themes with volume/trend | What are customers struggling with? | Core |
| Prioritization Studio with “Why this rank?” | What do we do first, and why? | Core — flagship |
| Emerging Issues | What do we need to react to *now*? | Core |
| Roadmap candidates + rationale | Record the decision | Core |
| Theme rename/merge/ignore, severity & fit override | Fix the AI's mistakes | Core (trust) |
| Semantic search / similar feedback | Gather evidence for a theme | Supporting |
| CSV upload | Use it on my data | Supporting |
| LLM summaries | Nice-to-read | **Cut** — adds no decision, costs money, hides evidence |
| Revenue impact | Business value | **Cut** — no revenue data; fabricating it would be dishonest |

## 10. AI architecture

React → FastAPI → LangChain → local embeddings → PostgreSQL + pgvector. A modular monolith (feedback, theme, prioritization, roadmap and ingestion services over a pure `ml/` package).

* **Embeddings:** `all-MiniLM-L6-v2` through LangChain's `Embeddings` interface — one object serves batch embedding, CSV uploads, the `PGVector` store and the retriever.
* **Clustering:** chosen by experiment, not by default. I compared KMeans (k = 20–120), DBSCAN and HDBSCAN on 65,669 embedded reviews. Density methods left **92–100% of reviews as noise** (short reviews don't form dense islands), which would leave a PM with no theme for most feedback. KMeans k = 80 assigns every record, has a largest cluster of 2.8% and a stability ARI of 0.56 under 80% subsampling. Silhouette is low (0.03) for every full-corpus method — reported rather than hidden.
* **Labels:** class-based TF-IDF keywords and quotes closest to the cluster centre. No LLM — labels are meant to be edited.
* **Sentiment:** VADER + a weak rating signal. DistilBERT was tested and was not better (78.9% vs 82.0% accuracy against star ratings on 3,000 reviews) and is orders of magnitude slower, so I kept the simple option.
* **Severity:** explicit rules; each point is traceable to a named signal.
* **Trend:** window length picked from the data; volume-adjusted z-score (so a dataset-wide surge isn't flagged as a theme problem).

**LangChain, honestly:** used for the embeddings abstraction, the PGVector store and the retriever. It is not an agent framework here and nothing in the product needs one.

## 11. Human-in-the-loop design

Every AI proposal has an override that **persists**:

| AI proposes | PM can |
|---|---|
| Theme label | Rename (stored as `pm_label`; the generated label is kept and restorable) |
| Theme boundaries | Merge themes; reassign a single record |
| Severity | Override to low/medium/high/critical |
| Weights | Move sliders; save them |
| Strategic fit | Set 0–10 per theme (defaults to a neutral 5 — never guessed) |
| Backlog membership | Mark a theme ignored |
| Priority | Turn it into a roadmap decision with rationale and evidence |

**The human feedback learning loop.** Every single-record correction is written to `theme_corrections` (feedback, old theme, new theme, timestamp). That is a growing set of labeled examples a future model could learn from. **Retraining is not implemented**; the loop is the data foundation, and I say so rather than claim online learning.

## 12. Success metrics

*Proposed, not measured (there are no live users):*

* Time from “new feedback batch” to a written roadmap decision.
* % of roadmap items with linked evidence and a rationale.
* PM override rate (rename/merge/reassign) — high early, falling as themes stabilize.
* Per-theme correction rate — a model-quality signal that comes free from `theme_corrections`.
* Emerging-issue precision — flagged issues later confirmed as real.
* Share of high/critical themes with an explicit decision.

*Measured in this build* (`reports/`): 65,669 records analyzed; 80 themes; 2,622 exact duplicates consolidated; 2 emerging issues flagged in the latest 30-day window; 48 automated tests passing.

## 13. Evaluation

| Layer | What was done | Result |
|---|---|---|
| Clustering (intrinsic) | Silhouette, Davies–Bouldin, stability, size distribution, topic diversity across 11 configurations | KMeans k=80 selected on a pre-stated rule; density methods rejected for coverage |
| Sentiment (proxy) | VADER vs DistilBERT vs star-rating labels, n = 3,000 | 82.0% vs 78.9% accuracy; majority baseline 75.2% |
| Theme assignment | Seeded 150-record random sample + labeling workflow + metric calculator (precision with Wilson interval, clustering agreement) | Workflow built; results are not reported in this document |

I deliberately did **not** invent “85% precision”. The workflow (`scripts/create_labeling_sample.py` → label 150 rows → `scripts/evaluate_labels.py`) reports precision with a Wilson interval and warns when n < 100.

A product lesson from testing the metrics: **pairwise recall/F1 against a human taxonomy are misleading** when the human categories are far coarser than the model's themes (recall collapses by construction). Precision (“is this record in a sensible theme?”) and homogeneity are the metrics to lead with.

## 14. Product trade-offs

| Trade-off | Chosen | Why |
|---|---|---|
| Coverage vs. cluster purity | Coverage (KMeans) | A PM needs every record in a theme; a pure core covering 6% of data is useless |
| Granularity | 80 themes | Fine enough to be actionable, coarse enough to scan; merge exists for the rest |
| Black-box model vs. rules | Rules for severity, simple lexicon for sentiment | Explainability beats a few points of accuracy for a decision tool |
| LLM labels vs. keywords | Keywords | Free, local, auditable — and editable |
| Relative vs. absolute normalization | Min–max for frequency/impact/sentiment; absolute for severity/trend/fit | Scores need spread to discriminate; severity and trend have meaningful absolute scales (found when early scores clustered at 61–65) |
| Raw vs. volume-adjusted trend | Volume-adjusted | The dataset has a volume surge; raw counts flag everything |

## 15. Limitations

* Theme-assignment precision is not reported here; the labeling workflow exists but no results are published.
* Some themes are generic complaint-tone clusters (“Fix / Fixed / Problem”) rather than product topics; the keyword labeling can't distinguish tone from topic. The PM can rename, merge or ignore them.
* Open-source Android reviews are not a B2B product: no segments, revenue, user IDs, tickets or NPS.
* Per-app sampling changes absolute volumes; “recent” is relative to the dataset's end (2017-05-02).
* Dataset license is unknown, so it is downloaded rather than redistributed.
* Persona, pain points and competitor positioning are hypotheses, not research findings.

## 16. Future roadmap

1. **Close the loop:** train a lightweight reassignment model on `theme_corrections`; report correction rate per theme.
2. **Run the human evaluation** (150 rows, ~30–45 min) and publish precision with its interval.
3. **Near-duplicate consolidation** using embedding similarity (today only exact duplicates are merged).
4. **Connectors** for support tickets, App Store Connect, NPS — the schema already carries `source` and `customer_segment`.
5. **Weighted impact** once revenue/segment data exists, with the weight exposed in the same slider UI.
6. **Optional local-LLM label suggestions** that the PM accepts or rejects — never auto-applied.
7. **Theme versioning** across releases to see whether a shipped fix actually reduced a theme.
