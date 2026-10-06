from __future__ import annotations

from sqlalchemy import Float, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class OrderLine(Base):
    __tablename__ = "order_lines"
    line_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    invoice: Mapped[str] = mapped_column(String, index=True)
    customer_id: Mapped[int] = mapped_column(Integer, index=True)
    stock_code: Mapped[str] = mapped_column(String, index=True)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    country: Mapped[str] = mapped_column(String, index=True)
    invoice_date: Mapped[str] = mapped_column(String, index=True)
    quantity: Mapped[float] = mapped_column(Float)
    unit_price: Mapped[float] = mapped_column(Float)
    line_value: Mapped[float] = mapped_column(Float)
    risk: Mapped[float] = mapped_column(Float)
    raw_score: Mapped[float] = mapped_column(Float)
    tier: Mapped[str] = mapped_column(String, index=True)
    outcome: Mapped[float | None] = mapped_column(Float, nullable=True)
    credited_value: Mapped[float] = mapped_column(Float)
    split: Mapped[str] = mapped_column(String, index=True)
    features_json: Mapped[str] = mapped_column(Text)
    drivers_json: Mapped[str] = mapped_column(Text)


class Product(Base):
    __tablename__ = "products"
    stock_code: Mapped[str] = mapped_column(String, primary_key=True)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    observed_lines: Mapped[int] = mapped_column(Integer)
    credited_lines: Mapped[int] = mapped_column(Integer)
    observed_rate: Mapped[float] = mapped_column(Float)
    revenue: Mapped[float] = mapped_column(Float)
    credited_value: Mapped[float] = mapped_column(Float)
    units: Mapped[float] = mapped_column(Float)
    scored_lines: Mapped[int] = mapped_column(Integer)
    avg_risk: Mapped[float] = mapped_column(Float)
    high_risk_lines: Mapped[int] = mapped_column(Integer)
    value_at_risk: Mapped[float] = mapped_column(Float)


class Weekly(Base):
    __tablename__ = "weekly"
    week: Mapped[str] = mapped_column(String, primary_key=True)
    lines: Mapped[int] = mapped_column(Integer)
    observed_lines: Mapped[int] = mapped_column(Integer)
    credited_lines: Mapped[int] = mapped_column(Integer)
    scored_lines: Mapped[int] = mapped_column(Integer)
    avg_risk: Mapped[float | None] = mapped_column(Float, nullable=True)
    revenue: Mapped[float] = mapped_column(Float)
    observed_rate: Mapped[float | None] = mapped_column(Float, nullable=True)


class Segment(Base):
    __tablename__ = "segments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dimension: Mapped[str] = mapped_column(String, index=True)
    segment: Mapped[str] = mapped_column(String)
    lines: Mapped[int] = mapped_column(Integer)
    observed_lines: Mapped[int] = mapped_column(Integer)
    credited_lines: Mapped[int] = mapped_column(Integer)
    observed_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    scored_lines: Mapped[int] = mapped_column(Integer)
    avg_risk: Mapped[float | None] = mapped_column(Float, nullable=True)
    value_at_risk: Mapped[float] = mapped_column(Float)
    revenue: Mapped[float] = mapped_column(Float)


class KV(Base):
    __tablename__ = "kv"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(Text)
