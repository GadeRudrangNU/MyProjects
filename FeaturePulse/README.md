# FeaturePulse — AI Feedback-to-Roadmap Decision Engine

Turn fragmented customer feedback into evidence-backed product decisions.



## What it is

FeaturePulse helps a product manager answer one question:

**How do I turn thousands of pieces of fragmented customer feedback into defensible roadmap decisions?**

```
Feedback → Embeddings → Semantic Themes → Trends → Priority Engine → PM Decision → Roadmap
```

## Planned highlights

- Local-first and free: no paid APIs (sentence-transformers, scikit-learn, FAISS/HDBSCAN)
- Semantic clustering of real public feedback into themes, with keyword and representative-quote labels
- Emerging-issue detection (recent window vs. baseline, z-score)
- Explainable, adjustable prioritization (PM-controlled weights with a per-theme score breakdown)
- Human-in-the-loop: rename/merge themes, override severity, correct assignments, promote to roadmap
- Honest evaluation workflow (human-labeled sample; no invented metrics)

**Stack:** Python, FastAPI, SQLAlchemy, sentence-transformers, scikit-learn, React, TypeScript, Tailwind, Recharts

---
Author: Rudrang Gade
