from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import session_dep
from ..models import AIGeneration, AnalyticsEvent, Job, ResearchResult
from ..services import ai_service, analytics, embeddings, metrics, store

router = APIRouter()


@router.get("/health")
def health(session: Session = Depends(session_dep)):
    return {"status": "ok", "ai_provider": settings.ai_provider, "ai_available": ai_service.ai_available(session),
            "embedding_backend": embeddings.backend_name(), "demo_data": settings.demo_data}


@router.get("/ai-usage")
def ai_usage(session: Session = Depends(session_dep)):
    cached = session.scalar(select(func.count()).select_from(AIGeneration)) or 0
    return {"provider": settings.ai_provider, "ai_available": ai_service.ai_available(session),
            "requests_today": ai_service.requests_today(session), "daily_limit": settings.ai_daily_limit,
            "cached_generations": cached}


@router.get("/analytics")
def get_analytics(session: Session = Depends(session_dep)):
    profile = store.get_profile(session)
    scores: dict[int, float | None] = {}
    matches: dict[int, dict] = {}
    analyzed = {i for (i,) in session.execute(select(AnalyticsEvent.job_id).where(
        AnalyticsEvent.name == "job_analyzed", AnalyticsEvent.job_id.is_not(None)))}
    for job in session.scalars(select(Job)):
        m = store.get_match(session, job, profile)
        scores[job.id] = m["overall"] if m else None
        if m and job.id in analyzed:
            matches[job.id] = m
    return analytics.compute_analytics(session, scores, matches)


@router.get("/product-metrics")
def product_metrics(session: Session = Depends(session_dep)):
    return metrics.compute_product_metrics(session)


@router.get("/research-metrics")
def research_metrics(session: Session = Depends(session_dep)):
    return metrics.compute_research_metrics(metrics.research_rows(session))
