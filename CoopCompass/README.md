# CoopCompass - AI Co-op Search & Application Assistant

AI-assisted co-op discovery, application preparation, and job-search intelligence for students.


## What it is

CoopCompass helps a student answer one question:

**Which of these openings deserve my limited time, why, and what should I do about it?**

```
Profile -> Discover -> Rank -> Understand Fit -> Tailor -> Apply -> Track -> Learn
```

## Planned highlights

- Explainable job matching: deterministic, adjustable scoring (skills, experience, role, education, location, preferences) with evidence from the student's own resume, not an opaque LLM score
- Resume gap analysis that separates evidence present, evidence that is weak, and genuine gaps. It never invents experience
- Human-in-the-loop drafting: AI suggestions are grounded in the resume and need user approval
- Application tracker with outcome analytics and local, privacy-first product instrumentation
- Free and local-first: FastAPI + SQLite, local sentence-transformers embeddings, optional Gemini free tier with a graceful offline fallback
- Honest measurement: research and time-saved metrics are computed from real data only, never fabricated. The app does not auto-submit applications

**Stack:** Python, FastAPI, SQLAlchemy, SQLite, sentence-transformers, Gemini API (optional), React, TypeScript, Vite, Tailwind CSS, Recharts

---
Author: Rudrang Gade
