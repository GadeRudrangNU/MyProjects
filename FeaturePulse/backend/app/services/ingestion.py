"""Ingestion Service: CSV upload with user-defined column mapping, validation, and NLP enrichment.

Missing optional fields stay NULL -- nothing is fabricated. New feedback is embedded with the same
local model, assigned to the nearest existing theme (cosine to centroid, else Uncategorized) and its
vector is stored in pgvector through LangChain.
"""
from __future__ import annotations

import io
import re

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from backend.app.models import Feedback, FeedbackThemeMapping, IngestionRun, Theme
from backend.app.services import stats, vectors
from backend.app.services.themes import ServiceError
from ml import config, preprocessing as pp, sentiment as sm, severity as sv

MAX_BYTES = 20 * 1024 * 1024
MAX_ROWS = 50_000
FIELDS = ("text", "date", "rating", "source", "segment", "product_area")
GUESSES = {
    "text": ["text", "feedback", "review", "comment", "body", "content", "message", "description"],
    "date": ["date", "created_at", "created", "timestamp", "time", "submitted"],
    "rating": ["rating", "score", "stars", "star", "nps"],
    "source": ["source", "channel", "origin"],
    "segment": ["segment", "customer_segment", "plan", "tier", "persona"],
    "product_area": ["product_area", "area", "component", "category", "app", "package_name"],
}


def read_csv(content: bytes) -> pd.DataFrame:
    if not content:
        raise ServiceError("The uploaded file is empty")
    if len(content) > MAX_BYTES:
        raise ServiceError(f"File too large (limit {MAX_BYTES // 1024 // 1024} MB)", 413)
    for enc in ("utf-8-sig", "latin-1"):
        try:
            df = pd.read_csv(io.BytesIO(content), encoding=enc, dtype=str, keep_default_na=False)
            break
        except UnicodeDecodeError:
            continue
        except (pd.errors.ParserError, pd.errors.EmptyDataError) as e:
            raise ServiceError(f"Could not parse CSV: {e}")
    else:
        raise ServiceError("Could not decode file; save it as UTF-8 CSV")
    if df.empty or len(df.columns) == 0:
        raise ServiceError("CSV has no data rows")
    return df


def guess_mapping(columns: list[str]) -> dict[str, str | None]:
    lower = {c.lower().strip(): c for c in columns}
    out: dict[str, str | None] = {}
    for field, names in GUESSES.items():
        out[field] = next((lower[n] for n in names if n in lower), None)
    return out


def preview(content: bytes) -> dict:
    df = read_csv(content)
    return {"columns": list(df.columns), "row_count": len(df), "suggested_mapping": guess_mapping(list(df.columns)),
            "sample": df.head(5).to_dict(orient="records")}


def _parse_dates(s: pd.Series) -> pd.Series:
    return pd.to_datetime(s.replace("", np.nan), errors="coerce", format="mixed")


def ingest(session: Session, content: bytes, mapping: dict[str, str | None], filename: str | None = None,
           source_label: str | None = None, embedder=None) -> dict:
    df = read_csv(content)
    if len(df) > MAX_ROWS:
        raise ServiceError(f"Too many rows ({len(df)}); limit is {MAX_ROWS}")
    if not mapping.get("text"):
        raise ServiceError("A feedback text column must be mapped")
    missing = [v for v in mapping.values() if v and v not in df.columns]
    if missing:
        raise ServiceError(f"Mapped columns not found in CSV: {missing}")

    stats_out = {"rows_read": len(df), "dropped_empty_text": 0, "dropped_too_short_or_noisy": 0,
                 "dropped_non_english": 0, "duplicates_in_file": 0, "duplicates_existing": 0,
                 "invalid_dates": 0, "invalid_ratings": 0}
    w = pd.DataFrame({"text": df[mapping["text"]].map(pp.clean_text)})
    w["created_at"] = _parse_dates(df[mapping["date"]]) if mapping.get("date") else pd.NaT
    stats_out["invalid_dates"] = int(w.created_at.isna().sum()) if mapping.get("date") else 0
    if mapping.get("rating"):
        w["rating"] = pd.to_numeric(df[mapping["rating"]].replace("", np.nan), errors="coerce")
        stats_out["invalid_ratings"] = int(w.rating.isna().sum() - (df[mapping["rating"]] == "").sum())
    else:
        w["rating"] = np.nan
    for field, col in (("source", mapping.get("source")), ("customer_segment", mapping.get("segment")),
                       ("product_area", mapping.get("product_area"))):
        w[field] = df[col].replace("", None) if col else None
    if not mapping.get("source"):
        w["source"] = source_label or "csv_upload"

    empty = w.text.str.len() == 0
    stats_out["dropped_empty_text"] = int(empty.sum())
    w = w[~empty]
    ok = w.text.map(pp.is_informative)
    stats_out["dropped_too_short_or_noisy"] = int((~ok).sum())
    w = w[ok]
    en = w.text.map(pp.looks_english)
    stats_out["dropped_non_english"] = int((~en).sum())
    w = w[en]

    w["key"] = w.text.map(pp.dedupe_key)
    n0 = len(w)
    w = w.drop_duplicates("key")
    stats_out["duplicates_in_file"] = n0 - len(w)
    w["id"] = [pp.feedback_id(str(r.source), r.product_area, "" if pd.isna(r.created_at) else r.created_at.strftime("%Y-%m-%d"), r.text)
               for r in w.itertuples()]
    existing = {i for (i,) in session.query(Feedback.id).filter(Feedback.id.in_(w.id.tolist())).all()}
    stats_out["duplicates_existing"] = len(existing)
    w = w[~w.id.isin(existing)]
    if w.empty:
        raise ServiceError(f"No valid new feedback rows to import. Details: {stats_out}")

    run = IngestionRun(source=str(w.source.iloc[0]), filename=filename, column_mapping=mapping, stats=stats_out)
    session.add(run)
    session.flush()

    from ml.embeddings import embed_texts, get_embedder
    emb = embed_texts(w.text.tolist(), embedder or get_embedder())
    themes = session.query(Theme).filter(Theme.merged_into_id.is_(None), Theme.centroid.isnot(None)).all()
    if themes:
        C = np.array([t.centroid for t in themes])
        sims = emb @ C.T
        best, best_sim = sims.argmax(axis=1), sims.max(axis=1)
    unc = session.query(Theme).filter_by(kind="uncategorized").first()
    if unc is None:
        unc = Theme(id=0, generated_label="Uncategorized", keywords=[], kind="uncategorized")
        session.add(unc)
        session.flush()

    assigned = unassigned = 0
    for i, r in enumerate(w.itertuples()):
        rating = None if pd.isna(r.rating) else float(r.rating)
        s = sm.sentiment_score(r.text, rating if rating is not None and 1 <= rating <= 5 else None)
        score, hits = sv.severity_score(r.text, s, rating if rating is not None and 1 <= rating <= 5 else None)
        session.add(Feedback(
            id=r.id, source=r.source, created_at=None if pd.isna(r.created_at) else r.created_at.to_pydatetime(),
            customer_segment=r.customer_segment, text=r.text, rating=rating, sentiment=s,
            sentiment_label=sm.sentiment_label(s), severity=sv.level_for(score), severity_score=score,
            severity_signals=hits, product_area=r.product_area, synthetic=False, ingestion_run_id=run.id))
        if themes and best_sim[i] >= config.ASSIGN_MIN_SIMILARITY:
            tid, sim = themes[int(best[i])].id, float(best_sim[i])
            assigned += 1
        else:
            tid, sim = unc.id, None
            unassigned += 1
        session.flush()
        session.add(FeedbackThemeMapping(feedback_id=r.id, theme_id=tid, similarity=sim, assigned_by="model"))
    session.flush()
    store = vectors.get_vector_store(embedder)
    vectors.add_vectors(store, w.id.tolist(), w.text.tolist(), emb,
                        [{"feedback_id": i, "product_area": p} for i, p in zip(w.id, w.product_area)])
    stats_out.update({"imported": len(w), "assigned_to_existing_theme": assigned, "uncategorized": unassigned,
                      "with_rating": int(w.rating.notna().sum()), "with_date": int(w.created_at.notna().sum())})
    run.stats = stats_out
    session.commit()
    stats.invalidate()
    return {"run_id": run.id, **stats_out}
