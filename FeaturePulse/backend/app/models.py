"""SQLAlchemy schema. Embeddings live in LangChain's PGVector collection (pgvector column),
linked to `feedback` by feedback_id in the embedding metadata."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, func)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Feedback(Base):
    __tablename__ = "feedback"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    source: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime | None] = mapped_column(DateTime)
    customer_segment: Mapped[str | None] = mapped_column(String(64))   # null = unknown
    text: Mapped[str] = mapped_column(Text)
    rating: Mapped[float | None] = mapped_column(Float)                # null = unknown
    sentiment: Mapped[float | None] = mapped_column(Float)
    sentiment_label: Mapped[str | None] = mapped_column(String(16))
    severity: Mapped[str | None] = mapped_column(String(16))
    severity_score: Mapped[float | None] = mapped_column(Float)
    severity_signals: Mapped[dict | None] = mapped_column(JSON)
    product_area: Mapped[str | None] = mapped_column(String(128))
    synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    meta: Mapped[dict | None] = mapped_column("metadata", JSON)
    ingestion_run_id: Mapped[int | None] = mapped_column(ForeignKey("ingestion_runs.id"))
    __table_args__ = (Index("ix_feedback_created", "created_at"), Index("ix_feedback_area", "product_area"))


class Theme(Base):
    __tablename__ = "themes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    generated_label: Mapped[str] = mapped_column(String(200))
    pm_label: Mapped[str | None] = mapped_column(String(200))          # manual override (persisted)
    keywords: Mapped[list | None] = mapped_column(JSON)
    representative_ids: Mapped[list | None] = mapped_column(JSON)
    centroid: Mapped[list | None] = mapped_column(JSON)                # for assigning new uploads
    kind: Mapped[str] = mapped_column(String(16), default="issue")     # issue | praise | uncategorized
    ignored: Mapped[bool] = mapped_column(Boolean, default=False)
    severity_override: Mapped[str | None] = mapped_column(String(16))
    strategic_fit: Mapped[float] = mapped_column(Float, default=5.0)   # PM-defined, 0-10
    merged_into_id: Mapped[int | None] = mapped_column(ForeignKey("themes.id"))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    @property
    def label(self) -> str:
        return self.pm_label or self.generated_label


class FeedbackThemeMapping(Base):
    __tablename__ = "feedback_theme_mapping"
    feedback_id: Mapped[str] = mapped_column(ForeignKey("feedback.id"), primary_key=True)
    theme_id: Mapped[int] = mapped_column(ForeignKey("themes.id"), index=True)
    similarity: Mapped[float | None] = mapped_column(Float)
    assigned_by: Mapped[str] = mapped_column(String(16), default="model")   # model | pm
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ThemeCorrection(Base):
    """Human-feedback learning loop: every PM correction is stored as a labeled example."""
    __tablename__ = "theme_corrections"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    feedback_id: Mapped[str] = mapped_column(ForeignKey("feedback.id"), index=True)
    old_theme: Mapped[int | None] = mapped_column(ForeignKey("themes.id"))
    new_theme: Mapped[int] = mapped_column(ForeignKey("themes.id"))
    timestamp: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class RoadmapItem(Base):
    __tablename__ = "roadmap_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    theme_id: Mapped[int] = mapped_column(ForeignKey("themes.id"), unique=True)
    bucket: Mapped[str] = mapped_column(String(16))        # now | next | later | investigate | wont_do
    status: Mapped[str] = mapped_column(String(24), default="proposed")
    rationale: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    evidence_links: Mapped[list | None] = mapped_column(JSON)
    priority_snapshot: Mapped[float | None] = mapped_column(Float)   # score when promoted
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class PriorityWeights(Base):
    __tablename__ = "priority_weights"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), default="default", unique=True)
    frequency: Mapped[float] = mapped_column(Float)
    severity: Mapped[float] = mapped_column(Float)
    trend: Mapped[float] = mapped_column(Float)
    customer_impact: Mapped[float] = mapped_column(Float)
    sentiment: Mapped[float] = mapped_column(Float)
    strategic_fit: Mapped[float] = mapped_column(Float)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class IngestionRun(Base):
    __tablename__ = "ingestion_runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(64))
    filename: Mapped[str | None] = mapped_column(String(255))
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    status: Mapped[str] = mapped_column(String(16), default="completed")
    stats: Mapped[dict | None] = mapped_column(JSON)
    column_mapping: Mapped[dict | None] = mapped_column(JSON)


class MetaKV(Base):
    """Pipeline-level facts (trend window, clustering method, metrics) computed at load time."""
    __tablename__ = "pipeline_meta"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict | None] = mapped_column(JSON)
