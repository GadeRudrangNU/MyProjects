# Survey instrument (template)

Anonymous, ~6 minutes. Paste into Google Forms / Microsoft Forms. **Do not fabricate responses**; only real exports go into `data/research/survey_results.csv`.

**Intro text:** "I'm a graduate student building a tool to help students with co-op and job searches. This survey is anonymous and takes about 6 minutes. Your answers are used only to decide what to build."

## Questions and the CSV column each maps to
| # | Question | Type | CSV column |
|---|---|---|---|
| 1 | Which best describes you? (Master's / PhD / Undergraduate / Other) | single | `level` |
| 2 | Are you searching for: co-op, internship, full-time (select all) | multi | `search_types` (`;`-separated) |
| 3 | On average, how many hours per week do you spend *searching and reading* postings? | number | `weekly_search_hours` |
| 4 | How many applications do you submit per week? | number | `weekly_applications` |
| 5 | On average, how many minutes does one application take (tailoring resume, forms, cover letter)? | number | `minutes_per_application` |
| 6 | Which tools do you use? LinkedIn, Handshake, Company sites, Indeed, Spreadsheet, Notion, ChatGPT/other AI, Other | multi | `tools` (`;`-separated) |
| 7 | How hard is it to judge whether you are a good fit for a posting? (1 very easy – 5 very hard) | 1-5 | `fit_eval_difficulty` |
| 8 | Do you tailor your resume per application? (Always / Sometimes / Never) | single | `tailors_resume` |
| 9 | How do you track applications? (Spreadsheet / Notes app / Email / Platform's own / Not tracking) | single | `tracking_method` |
| 10 | Biggest pain points (pick up to 3): Finding relevant postings; Reading long job descriptions; Deciding if I am a good fit; Tailoring resume; Writing cover letters; Tracking applications; Deadlines; Work-authorization uncertainty; Not hearing back; Other | multi | `pain_points` (`;`-separated) |
| 11 | How much would you trust an AI-generated "fit score" for a job? (1 not at all – 5 completely) | 1-5 | `trust_ai_recommendations` |
| 12 | What would make you trust it more? (open text; optional) | text | `trust_text` |
| 13 | Concerns about uploading your resume to a job-search tool (open; optional) | text | `privacy_text` |
| 14 | Which features would you want? Fit ranking with explanation; Resume gap analysis; Resume tailoring suggestions; Cover-letter drafts; Application tracker; Deadline reminders; Networking message drafts; Analytics on my own results | multi | `desired_features` (`;`-separated) |
| 15 | Would you be willing to do a 30-minute interview or try a prototype? (Yes/No; collect contact separately from answers) | single | *(not stored in dataset)* |

## Export format
`data/research/survey_results.csv` — header exactly:

```
respondent_id,level,search_types,weekly_search_hours,weekly_applications,minutes_per_application,tools,fit_eval_difficulty,tailors_resume,tracking_method,pain_points,trust_ai_recommendations,desired_features
```
`respondent_id` is a random label (not an email/name). Multi-select answers are `;`-separated. The importer only requires `respondent_id` and uses whichever metric columns exist. `data/research/survey_results.csv` is git-ignored by default; remove that line from `.gitignore` only if every row is fully anonymised and you want to publish it.

## Notes for good survey hygiene
- Pilot with 3-5 people first; fix ambiguous wording (e.g. "searching" vs "applying").
- Q3-Q5 are self-reported estimates; say so in any write-up.
- Report the real N and how respondents were recruited.
