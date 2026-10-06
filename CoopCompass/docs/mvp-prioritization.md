# MVP prioritization (RICE)

RICE = (Reach × Impact × Confidence) / Effort. **All inputs below are the author's judgement before user research**, not measured data. Reach is the share of target students (graduate students job-searching) plausibly affected per week on a 1–10 scale; Impact 0.25 (minimal) – 3 (massive); Confidence as a fraction (low because research is pending); Effort in person-weeks. Re-score after the survey/interviews.

| Feature | Reach | Impact | Confidence | Effort | RICE | Decision |
|---|---|---|---|---|---|---|
| Job ingestion (paste / CSV / URL) | 10 | 2 | 0.9 | 1.5 | 12.0 | **MVP** — prerequisite for everything |
| Explainable job matching | 9 | 3 | 0.6 | 2 | 8.1 | **MVP** — flagship differentiator |
| Match explanation + evidence | 9 | 2 | 0.7 | 1 | 12.6 | **MVP** — trust (H3) |
| Resume gap analysis | 8 | 2 | 0.7 | 1 | 11.2 | **MVP** — reuses the matching evidence index |
| Application tracker (Kanban) | 9 | 1 | 0.9 | 1 | 8.1 | **MVP** — replaces the spreadsheet; produces outcome data |
| Application analytics + instrumentation | 6 | 1 | 0.8 | 1 | 4.8 | **MVP (descriptive only)** — needed to measure anything |
| Resume tailoring (grounded) | 7 | 1.5 | 0.5 | 2 | 2.6 | **MVP, optional/Gemini** — local fallback shows which bullets to lead with |
| Cover-letter / answer drafts | 7 | 0.5 | 0.5 | 1 | 1.8 | **MVP, minimal** — template locally, Gemini optional; H5 says students may value it less |
| Outcome learning (descriptive) | 4 | 1 | 0.5 | 1 | 2.0 | **MVP-lite** — status history + descriptive stats; no ML |
| Networking message assistant | 5 | 0.5 | 0.3 | 1 | 0.75 | **Later** — shipped only as a small draft type |
| Learned/personalised ranking | 4 | 2 | 0.2 | 4 | 0.4 | **Out** — needs ~30+ real outcomes; revisit with data |
| Automated application submission | 6 | 1 | 0.1 | 6+ | ≤0.1 | **Deliberately OUT** |

## Why automated submission is excluded (a deliberate PM decision)
- **Platform restrictions:** LinkedIn, Handshake and most ATS terms prohibit automated submission/scraping; it risks the student's account.
- **Trust and accountability:** the student is accountable for every claim on an application; an agent that submits on their behalf removes their ability to catch an error.
- **Accuracy:** form fields, eligibility questions and work-authorization answers are high-stakes; a wrong answer can disqualify or misrepresent.
- **Application quality vs. quantity:** automation optimises volume; the product thesis is fewer, better-targeted applications.
- **Privacy:** it would require credentials for third-party accounts.
- **Engineering cost:** brittle per-site automation with a high maintenance burden for low differentiated value.

## Other exclusions
Paid job-board APIs and scraping (cost + terms of service); multi-user accounts/auth (single-user local-first MVP); mobile app; browser extension; employer-side features; career-advisor dashboard (secondary persona — noted for roadmap; aggregate skill-gap data would need privacy design).

## What would change these scores
Survey/interview data on H1–H5, pilot usage (do users open Gap Analysis? accept suggestions?), and any measured time saved.
