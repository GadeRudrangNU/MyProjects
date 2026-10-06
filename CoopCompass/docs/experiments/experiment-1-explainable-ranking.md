# Experiment 1 — Explainable ranking

**Status: DESIGNED, NOT RUN.** No experiment data exists. Do not cite results from this document.

| | |
|---|---|
| Hypothesis (H3) | Showing the factor breakdown and resume evidence behind a match score increases trust and the rate at which users save analyzed jobs, compared with a bare score. |
| Control | Job view shows only the overall Match Score. |
| Treatment | Match Score + factor breakdown + "evidence from your profile". |
| Unit of randomisation | User (a local app has one user, so in practice: a within-user crossover by alternating weeks, or between-user across pilot participants). |
| Primary metric | Job-save rate among analyzed jobs = `job_saved` / `job_analyzed` (distinct jobs). |
| Secondary | Time-to-decision: seconds from `job_analyzed` to `job_saved` or `job_ignored`. |
| Guardrail | Incorrect-recommendation reports (`incorrect_recommendation_reported` events per 100 analyzed jobs) must not rise. |
| Confounds | Job quality differs by week in a crossover; users who dislike explanations may disengage. Randomise week order, compare within-user. |

## Instrumentation status
Events exist (`job_analyzed`, `job_saved`, `job_ignored`, `incorrect_recommendation_reported`, event `properties`). **Variant assignment is not implemented**: add a `variant` property to events and a UI toggle before running.

## Sample size reality check
With a single-digit pilot, this cannot reach statistical significance. Treat as a qualitative signal combined with interviews; report the n, and use paired within-user comparison. For a real A/B test you would need roughly several hundred analyzed jobs per arm to detect a 10-point save-rate difference.

## Decision rule (pre-registered)
Ship the explanation as default if treatment save rate ≥ control, guardrail flat, and ≥ 3 of 5 interviewees say the breakdown made them trust the score more. Otherwise show the breakdown collapsed by default.
