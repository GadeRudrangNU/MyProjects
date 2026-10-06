# Experiment 2 — Ranked queue vs. chronological queue

**Status: DESIGNED, NOT RUN.** No experiment data exists. Do not cite results from this document.

| | |
|---|---|
| Hypothesis (H2) | Presenting jobs ranked by fit reduces time spent evaluating irrelevant jobs. |
| Control | Jobs listed newest-first. |
| Treatment | Jobs listed by match score (Best Match). |
| Primary metric | Time-to-first-application-start per session: minutes from `session_start` to the first `application_started`. |
| Secondary | Applications started per session. |
| Guardrail | Diversity of roles considered: number of distinct role families (see `role_family()` in `analytics.py`) among jobs opened per session must not collapse (ranking should not narrow exploration to one title). |
| Confounds | Ranking quality depends on a complete profile; novelty effects; the user already knows what they want. |

## Instrumentation status
`session_start/session_end`, `application_started`, `job_analyzed` events exist. Sort mode is a UI parameter but is not yet logged as a `variant` property; the Job Explorer would need to log it and randomise default sort per session.

## Caveats
Small-n pilots only support descriptive, within-user comparison. A ranked list also changes *what* is opened, so time-to-first-start alone can be misleading; read it with the guardrail and with qualitative feedback.

## Decision rule (pre-registered)
Keep "Best Match" as the default if time-to-first-start is lower or equal and the diversity guardrail does not drop by more than 20%; otherwise default to newest and offer ranking as an option.
