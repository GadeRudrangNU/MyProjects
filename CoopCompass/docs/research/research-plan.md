# Research plan

**Status: not yet executed.** This is a plan. No participants have been surveyed or interviewed, and nothing in this repository should be read as research findings. Real results go in `research-findings-template.md` only after they exist.

## Goal
Find out whether the problems CoopCompass assumes (see hypotheses in the README) are real, how large they are, and which features students actually value, *before* investing further in the product.

## Research questions
1. How much time do graduate students spend per week finding, evaluating and applying to co-ops/jobs?
2. Where does that time go (searching, reading JDs, tailoring resumes, tracking)? Which step is most painful?
3. How do students decide a posting is "worth applying to", and how do they handle work-authorization constraints?
4. Would students trust an automated fit score? What evidence would they need?
5. Do students value prioritisation (ranking) over generated text (cover letters)?
6. What are the privacy concerns about uploading a resume to a tool?

## Hypotheses to test (unvalidated)
| ID | Hypothesis | Evidence that would support it | Evidence that would refute it |
|---|---|---|---|
| H1 | Students spend substantial time evaluating low-fit opportunities | Respondents report reading many JDs they then discard | Most report finding fit easy to judge quickly |
| H2 | An explainable ranking can reduce manual JD evaluation time | Evaluation is a top-3 pain point; interviewees say ranking would change what they open | Evaluation is rarely mentioned; students prefer browsing |
| H3 | Evidence behind a score increases trust vs. an unexplained percentage | Interviewees ask "why" about scores; prefer the breakdown concept | No preference, or they distrust any automated score |
| H4 | Tracking outcomes can improve future recommendations | Students already track outcomes and want insight from them | Students do not track, or see no use |
| H5 | Prioritisation is valued more than generic AI cover letters | Feature-ranking favours ranking/tracking over drafting | Drafting ranks first |

## Methods
- **Survey** (`survey-template.md`): 5-8 minutes, anonymous, distributed to student groups / program channels. Target is whatever response count is reachable honestly; report the actual count.
- **Interviews** (`interview-guide.md`): 30 minutes, 5-8 students if feasible, with consent to take notes. Prototype concept walkthrough in the final 8 minutes.
- **Usage pilot** (in-app instrumentation): a few students use the app on their real search for 2+ weeks. Time-saved is measured with the in-app timer plus an optional self-reported baseline (see README "Measurement").

## Sampling and bias (be explicit in any write-up)
Convenience sample of graduate students reachable by the author; skews toward one program/university and toward people willing to answer a survey about job search. Findings are directional, not generalisable.

## Ethics and privacy
Anonymous survey; no names or emails in the dataset (`respondent_id` is a random label). Interview notes are de-identified. Share the consent text from the guide. Never store resumes of interviewees.

## Analysis
`scripts/research_import.py` reads `data/research/survey_results.csv` and generates `reports/research_metrics.json` (respondent count, median weekly search time, mean time per application, top pain points, tools, feature preferences). Interview notes are coded manually into themes (see findings template). The README metrics block is generated from the JSON.

## Decision criteria (set in advance)
- If evaluating/triaging postings is not among the top 3 pain points, deprioritise ranking and revisit the MVP scope.
- If most interviewees reject any automated fit score regardless of explanation, reposition ranking as an optional sort, not the default.

## Timeline (suggested)
Week 1 pilot survey with 3-5 people to fix wording → Weeks 2-3 survey + interviews → Week 4 synthesis and MVP changes.
