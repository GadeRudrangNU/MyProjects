"""FeaturePulse API (modular monolith): routers -> product services -> ml pipeline -> Postgres/pgvector."""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from backend.app import db
from backend.app.models import Feedback, IngestionRun, MetaKV, Theme
from backend.app.services import feedback as fb_svc, ingestion, priorities, roadmap as rm_svc, stats, themes as th_svc, vectors
from backend.app.services.themes import ServiceError
from ml import config as ml_config

from contextlib import asynccontextmanager


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init_schema()
    yield


app = FastAPI(title="FeaturePulse API", version="1.0.0", lifespan=lifespan,
              description="Feedback-to-roadmap decision engine. AI proposes, the PM decides.")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(ServiceError)
async def service_error_handler(_: Request, exc: ServiceError):
    return JSONResponse(status_code=exc.status, content={"detail": str(exc)})


get_session = db.get_session
Sess = Depends(get_session)


# ---------- schemas ----------
class ThemePatch(BaseModel):
    label: str | None = None
    ignored: bool | None = None
    severity_override: str | None = None
    strategic_fit: float | None = Field(default=None, ge=0, le=10)
    notes: str | None = None


class MergeBody(BaseModel):
    source_ids: list[int]
    target_id: int
    label: str | None = None


class CorrectBody(BaseModel):
    new_theme_id: int


class WeightsBody(BaseModel):
    frequency: float = Field(ge=0)
    severity: float = Field(ge=0)
    trend: float = Field(ge=0)
    customer_impact: float = Field(ge=0)
    sentiment: float = Field(ge=0)
    strategic_fit: float = Field(ge=0)


class RecalcBody(BaseModel):
    weights: WeightsBody | None = None
    save: bool = False
    include_praise: bool = False


class RoadmapBody(BaseModel):
    theme_id: int
    bucket: str
    status: str = "proposed"
    rationale: str | None = None
    notes: str | None = None
    evidence_links: list[str] = []


class RoadmapPatch(BaseModel):
    bucket: str | None = None
    status: str | None = None
    rationale: str | None = None
    notes: str | None = None
    evidence_links: list[str] | None = None


# ---------- health / meta ----------
@app.get("/api/health")
def health(session: Session = Sess):
    session.execute(text("SELECT 1"))
    vec = session.execute(text("SELECT extversion FROM pg_extension WHERE extname='vector'")).scalar()
    return {"status": "ok", "database": "postgresql", "pgvector": vec,
            "feedback_records": session.query(Feedback).count()}


def _evaluation_status() -> dict:
    p = ml_config.REPORTS_DIR / "evaluation_metrics.json"
    if p.exists():
        return json.loads(p.read_text())
    return {"human_evaluation": {"status": "pending", "note": "Human evaluation pending."}}


@app.get("/api/meta")
def meta(session: Session = Sess):
    rows = {m.key: m.value for m in session.query(MetaKV).all()}
    return {"clustering": rows.get("clustering"), "evaluation": _evaluation_status(),
            "embedding_model": ml_config.EMBEDDING_MODEL}


# ---------- dashboard ----------
@app.get("/api/dashboard")
def dashboard(session: Session = Sess):
    table = stats.theme_table(session)
    df = stats.get_frame(session)
    themes = list(table["themes"].values())
    total = int(len(df))
    neg = int((df.sentiment_label == "negative").sum()) if total else 0
    ranking = priorities.ranking(session)["items"]
    hi = [r for r in ranking if r["severity"] in ("high", "critical") and r["roadmap_bucket"] is None][:10]
    ev = _evaluation_status().get("human_evaluation", {})
    by_month = (df.dropna(subset=["created_at"]).assign(m=lambda d: d.created_at.dt.to_period("M").astype(str))
                .groupby("m").agg(count=("feedback_id", "size"), sentiment=("sentiment", "mean"),
                                  negative=("sentiment_label", lambda x: int((x == "negative").sum()))).reset_index()
                if total else None)
    series = [] if by_month is None else [
        {"month": r.m, "count": int(r["count"]), "avg_sentiment": round(float(r.sentiment), 3),
         "negative_pct": round(100 * r.negative / r["count"], 1)} for _, r in by_month.iterrows()]
    sources = [] if not total else [{"name": str(k), "count": int(v)} for k, v in df.source.fillna("unknown").value_counts().items()]
    areas = [] if not total else [{"name": str(k), "count": int(v)} for k, v in df.product_area.fillna("unknown").value_counts().head(12).items()]
    top = sorted((t for t in themes if t["kind"] != "uncategorized" and not t["ignored"]), key=lambda t: -t["mentions"])[:12]
    return {
        "total_feedback": total,
        "negative_pct": round(100 * neg / total, 1) if total else 0,
        "themes": sum(1 for t in themes if t["kind"] != "uncategorized"),
        "issue_themes": sum(1 for t in themes if t["kind"] == "issue"),
        "emerging_issues": sum(1 for t in themes if t["emerging"] and t["kind"] == "issue" and not t["ignored"]),
        "unresolved_high_priority": len(hi),
        "unresolved_high_priority_themes": [{"id": r["theme_id"], "label": r["label"], "priority": r["priority"]} for r in hi[:5]],
        "uncategorized": sum(t["mentions"] for t in themes if t["kind"] == "uncategorized"),
        "evaluation": ev,
        "trend_window": table["trend_window"],
        "timeseries": series, "sources": sources, "product_areas": areas,
        "top_themes": [{"id": t["id"], "label": t["label"], "mentions": t["mentions"], "severity": t["severity"],
                        "kind": t["kind"]} for t in top],
        "date_range": None if not total else [str(df.created_at.min().date()), str(df.created_at.max().date())],
        "synthetic_records": session.query(Feedback).filter(Feedback.synthetic.is_(True)).count(),
    }


# ---------- feedback ----------
@app.get("/api/feedback")
def feedback_list(q: str | None = None, theme_id: int | None = None, sentiment: str | None = None, source: str | None = None,
                  severity: str | None = None, segment: str | None = None, product_area: str | None = None,
                  date_from: str | None = None, date_to: str | None = None, page: int = Query(1, ge=1),
                  page_size: int = Query(25, ge=1, le=200), session: Session = Sess):
    return fb_svc.list_feedback(session, q, theme_id, sentiment, source, severity, segment, product_area,
                                date_from, date_to, page, page_size)


@app.get("/api/feedback/options")
def feedback_options(session: Session = Sess):
    return fb_svc.filter_options(session)


@app.get("/api/feedback/search")
def semantic_search(q: str = Query(min_length=3), k: int = Query(10, ge=1, le=30), session: Session = Sess):
    """Semantic (embedding) search through the LangChain retriever over pgvector."""
    hits = vectors.semantic_search(vectors.get_vector_store(), q, k)
    ids = [h["feedback_id"] for h in hits]
    return {"query": q, "results": [fb_svc.get_feedback(session, i) for i in ids]}


@app.get("/api/feedback/{feedback_id}")
def feedback_detail(feedback_id: str, session: Session = Sess):
    out = fb_svc.get_feedback(session, feedback_id)
    sims = vectors.similar_feedback(session, vectors.get_vector_store(), feedback_id, k=6)
    ids = [s["feedback_id"] for s in sims]
    meta_rows = {f.id: f for f in session.query(Feedback).filter(Feedback.id.in_(ids)).all()}
    out["similar"] = [{**s, "rating": meta_rows[s["feedback_id"]].rating, "sentiment": meta_rows[s["feedback_id"]].sentiment_label}
                      for s in sims if s["feedback_id"] in meta_rows]
    return out


@app.post("/api/feedback/{feedback_id}/correct-theme")
def correct_theme(feedback_id: str, body: CorrectBody, session: Session = Sess):
    return th_svc.correct_theme(session, feedback_id, body.new_theme_id)


@app.post("/api/feedback/upload/preview")
async def upload_preview(file: UploadFile = File(...)):
    return ingestion.preview(await file.read())


@app.post("/api/feedback/upload")
async def upload(file: UploadFile = File(...), mapping: str = Form(...), source_label: str | None = Form(None),
                 session: Session = Sess):
    try:
        mp = json.loads(mapping)
    except json.JSONDecodeError:
        raise ServiceError("mapping must be a JSON object")
    return ingestion.ingest(session, await file.read(), mp, file.filename, source_label)


@app.get("/api/ingestion-runs")
def ingestion_runs(session: Session = Sess):
    return [{"id": r.id, "source": r.source, "filename": r.filename, "started_at": r.started_at.isoformat(),
             "status": r.status, "stats": r.stats, "column_mapping": r.column_mapping}
            for r in session.query(IngestionRun).order_by(IngestionRun.id.desc()).all()]


# ---------- themes ----------
@app.get("/api/themes")
def themes_list(q: str | None = None, sentiment: str | None = None, source: str | None = None,
                severity: str | None = None, segment: str | None = None, product_area: str | None = None,
                date_from: str | None = None, date_to: str | None = None, kind: str | None = None,
                include_ignored: bool = False, sort: str = "mentions", session: Session = Sess):
    return th_svc.list_themes(session, q, sentiment, source, severity, segment, product_area, date_from, date_to,
                              kind, include_ignored, sort)


@app.post("/api/themes/merge")
def themes_merge(body: MergeBody, session: Session = Sess):
    return th_svc.merge_themes(session, body.source_ids, body.target_id, body.label)


@app.get("/api/themes/{theme_id}")
def theme_detail(theme_id: int, session: Session = Sess):
    return th_svc.get_theme(session, theme_id)


@app.patch("/api/themes/{theme_id}")
def theme_patch(theme_id: int, body: ThemePatch, session: Session = Sess):
    return th_svc.patch_theme(session, theme_id, body.model_dump(exclude_unset=True))


# ---------- emerging ----------
@app.get("/api/emerging")
def emerging(all: bool = False, session: Session = Sess):
    table = stats.theme_table(session)
    rows = []
    for t in table["themes"].values():
        tr = t["trend"]
        if not tr or t["ignored"] or t["kind"] == "uncategorized":
            continue
        if not all and not (tr["flagged"] and t["kind"] == "issue"):   # praise surges are not "issues"
            continue
        rows.append({"id": t["id"], "label": t["label"], "severity": t["severity"], "kind": t["kind"],
                     "mentions": t["mentions"], "keywords": t["keywords"][:5], **tr})
    rows.sort(key=lambda r: -r["z_score"])
    return {"window": table["trend_window"], "criteria": {
        "min_recent_count": ml_config.TREND_MIN_RECENT_COUNT, "min_z_score": ml_config.TREND_Z_FLAG,
        "min_volume_adjusted_increase_pct": 100 * ml_config.TREND_MIN_SHARE_INCREASE},
        "flagged_count": sum(1 for t in table["themes"].values() if t["emerging"] and t["kind"] == "issue" and not t["ignored"]),
        "items": rows}


# ---------- priorities ----------
@app.get("/api/priorities")
def priorities_get(include_praise: bool = False, session: Session = Sess):
    return priorities.ranking(session, include_praise=include_praise)


@app.post("/api/priorities/recalculate")
def priorities_recalc(body: RecalcBody, session: Session = Sess):
    weights = body.weights.model_dump() if body.weights else None
    if body.save and weights:
        priorities.save_weights(session, weights)
    return priorities.ranking(session, weights, body.include_praise)


# ---------- roadmap ----------
@app.get("/api/roadmap")
def roadmap_list(session: Session = Sess):
    return {"buckets": rm_svc.BUCKETS, "statuses": rm_svc.STATUSES, "items": rm_svc.list_roadmap(session)}


@app.post("/api/roadmap")
def roadmap_create(body: RoadmapBody, session: Session = Sess):
    return rm_svc.upsert(session, body.theme_id, body.bucket, body.status, body.rationale, body.notes, body.evidence_links)


@app.patch("/api/roadmap/{item_id}")
def roadmap_patch(item_id: int, body: RoadmapPatch, session: Session = Sess):
    return rm_svc.update(session, item_id, body.model_dump(exclude_unset=True))


@app.delete("/api/roadmap/{item_id}")
def roadmap_delete(item_id: int, session: Session = Sess):
    rm_svc.delete(session, item_id)
    return {"deleted": item_id}


# Serve the built frontend when present (single-process deployment).
_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _dist.exists():
    from fastapi import HTTPException
    from fastapi.responses import FileResponse

    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        """Client-side routes (e.g. /prioritization) must load index.html on refresh / deep link."""
        if full_path.startswith("api/"):
            raise HTTPException(404, "Not found")
        target = (_dist / full_path).resolve()
        if full_path and target.is_file() and _dist.resolve() in target.parents:
            return FileResponse(target)
        return FileResponse(_dist / "index.html")
