# CoopCompass — Product case study

> **Honesty note.** This is a portfolio case study of a product built by one person. User research and pilot measurement have **not** been run yet; sections 4 and 16 say so explicitly. Numbers appear only where they were measured. Hypotheses are hypotheses.

## 1. Problem
Graduate students searching for co-ops, internships and entry-level roles spread one decision across LinkedIn, Handshake, company sites, spreadsheets, resume files and AI chat tools. The expensive part is not finding postings; it is the repeated cycle of *read a long JD → guess whether it fits → compare to your resume → tailor → apply → remember what happened*. CoopCompass aims to reduce that cognitive and administrative load while the student stays in control of every submission.

## 2. Target users
- **Primary:** graduate students juggling coursework, networking, multiple resume versions, deadlines, and constraints such as work authorization, location and role preferences.
- **Secondary (not optimised in MVP):** career advisors who want aggregate skill-gap and friction insight.

## 3. Research plan
See [`research/research-plan.md`](research/research-plan.md), [`survey-template.md`](research/survey-template.md), [`interview-guide.md`](research/interview-guide.md). Hypotheses H1–H5 each have pre-stated supporting/refuting evidence and decision criteria.

## 4. Research findings
**Author-reported only.** Survey, interviews and a drafting-time pilot were run outside the app; the raw data is not in this repository, so no figures are reproduced here. Import the data (`scripts/research_import.py`) to make them verifiable.

## 5. Jobs-to-be-done
- *When* I find a promising posting, *I want* to know quickly whether it is worth my limited time and why, *so I can* focus on the few that matter.
- *When* I decide to apply, *I want* my existing experience surfaced for this role without inventing anything, *so my application is honest and strong*.
- *When* applications pile up, *I want* one place that shows status, deadlines and what is working, *so I don't forget or repeat mistakes*.

## 6. Existing workflow
Find job → read JD → decide → compare requirements → edit resume → draft content → apply → update spreadsheet → forget what happened. (Reconstructed from the author's own experience and secondary reasoning; to be validated by interviews.)

## 7. Pain points (hypothesised)
Time evaluating low-fit postings; unclear fit and sponsorship signals; resume tailoring effort; scattered tracking; generic AI output that may invent experience; no feedback loop from outcomes to targeting.

## 8. Product hypotheses
H1 students spend substantial time on low-fit postings; H2 explainable ranking reduces manual evaluation time; H3 evidence behind a score increases trust vs. an unexplained percentage; H4 outcome tracking can improve future recommendations; H5 students value prioritisation more than generic AI cover letters. **All unvalidated.**

## 9. MVP prioritization
RICE scoring in [`mvp-prioritization.md`](mvp-prioritization.md). In: ingestion, explainable matching + evidence, gap analysis, tracker, descriptive analytics, optional grounded tailoring/drafts. Out: automated submission (platform terms, trust, accuracy, privacy), learned ranking (insufficient data), networking assistant (later).

## 10. User journey
Profile (upload resume → *review/edit extracted data*) → Discover (paste / URL / CSV) → Rank (fit-sorted list) → Understand fit (breakdown + evidence + concerns) → Tailor (gap analysis, grounded suggestions, user approves) → Apply (on the employer's site, by the student) → Track (Kanban, notes, checklist) → Learn (descriptive outcome analytics).

| Discover and rank | Understand fit |
|---|---|
| ![Job explorer](../screenshots/job-explorer.png) | ![Job match](../screenshots/job-match.png) |

| Tailor | Prepare and apply |
|---|---|
| ![Resume Lab](../screenshots/resume-analysis.png) | ![Workspace](../screenshots/application-workspace.png) |

| Track | Learn |
|---|---|
| ![Tracker](../screenshots/tracker.png) | ![Analytics](../screenshots/analytics.png) |

*(Screenshots use the synthetic demo dataset.)*

## 11. Product architecture
React/TypeScript SPA → FastAPI → SQLite; local embeddings; optional server-side Gemini. Single local user, no accounts. See the Mermaid diagram in the README.

## 12. AI vs. deterministic decisions
| Decision | Method | Why |
|---|---|---|
| Resume/JD parsing, skill extraction | Rules + taxonomy | Auditable, free, reproducible |
| Match score and breakdown | Deterministic weighted formula; local embeddings for role similarity | A number the user will act on must be explainable and stable; an LLM score drifts and can't be inspected |
| Evidence mapping | Index from skill → profile bullets | Every claim must trace to the student's own text |
| Gap analysis | Same index + embeddings for responsibilities | Same |
| Resume bullet rewrites, cover letters | **Gemini (optional)** | Language generation is where an LLM adds real value |
| Guardrail on LLM output | Deterministic post-check rejecting new technologies/numbers | Reduces the chance of invented experience |
| Analytics, time-saved | SQL/statistics | No model needed |
| Personalised ranking | Not built | Needs outcome data we don't have |

## 13. Explainability
The score is the sum of six factor scores with adjustable weights (default 35/20/15/10/10/10). Each factor shows points, a one-line reason, and strong/partial/gap skill lists with the exact resume bullets that support each claim. Gaps always read "No evidence found in current resume." Related-but-not-equal skills (e.g. AWS vs Azure) are labelled *partial* with the reason disclosed.

## 14. Success metrics
*Targets (hypotheses, not results):* reduced time per evaluated posting and per application vs. self-reported baseline; higher fraction of applications to high-fit roles; users accepting a meaningful share of grounded suggestions; trust in score (qualitative). *Measurement is built:* active-time tracking by activity, optional baseline, `reports/product_metrics.json`, event funnel. Claims are blocked until ≥10 baseline observations exist.

## 15. Experimentation
Two experiments designed, **not run**: [explainable ranking](experiments/experiment-1-explainable-ranking.md) and [ranked queue](experiments/experiment-2-ranked-queue.md), each with primary, secondary and guardrail metrics and a pre-registered decision rule.

## 16. Results
**No measured results yet.** The generated `reports/product_metrics.json` currently reports zero users/applications because no real usage has been recorded. Engineering verification (tests, build) is reported in the README; it is not product evidence.

## 17. What didn't work (so far, building it)
- A taxonomy-based skill matcher is blind to skills it doesn't list; non-tech postings (e.g. mechanical design) get a low-confidence flag instead of a trustworthy score.
- Neutral defaults for unstated requirements (80% experience, 30% skills) still lift irrelevant jobs; role alignment is what separates them. Tuning is needed with real data.
- Family-based "related skill" credit was too generous at first (everything in "analytics" was related) and had to be restricted.
- Small ranking demos look convincing on synthetic data, which is exactly why synthetic data is labelled and never used for metrics.

## 18. Tradeoffs
Deterministic score vs. LLM nuance (chose trust). Local/free vs. best-possible extraction (chose local; resume parsing is heuristic and always user-reviewed). No scraping vs. job coverage (chose terms-of-service safety: paste, CSV, polite single-page URL fetch). Descriptive analytics vs. ML (chose honesty about small data). Single-user local app vs. accounts/sync (chose privacy and simplicity).

## 19. Limitations
Heuristic parsers; limited skill taxonomy; TF-IDF fallback is weaker than embeddings; seed postings are synthetic; URL import fails on many sites (by design: robots.txt, no login/bot bypass); Gemini output untested against a live key in the automated suite; self-reported baseline is biased; no user research yet.

## 20. Future roadmap
Run the survey and interviews; pilot with a handful of students for 2+ weeks; add variant assignment for the two experiments; calibrate default weights from real outcomes once ≥30 are recorded; richer taxonomy via user-added skills; advisor-facing aggregate view with privacy design; optional deployment guide; reminder notifications.
