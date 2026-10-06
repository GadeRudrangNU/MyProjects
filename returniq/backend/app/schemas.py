from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class PredictRequest(BaseModel):
    stock_code: str = Field(..., examples=["22423"], description="Catalogue product code")
    quantity: float = Field(..., gt=0, examples=[12])
    unit_price: float = Field(..., gt=0, examples=[4.95], description="Price per unit (GBP)")
    customer_id: int | None = Field(None, examples=[12748], description="Omit for a new/unknown customer")
    country: str = Field("United Kingdom", examples=["United Kingdom"])
    order_lines: int = Field(1, ge=1, description="Distinct products in the whole order")
    order_value: float | None = Field(None, gt=0, description="Whole-order value; defaults to this line's value")
    order_units: float | None = Field(None, gt=0)
    invoice_date: str | None = Field(None, description="ISO timestamp; defaults to the end of the dataset")


class Driver(BaseModel):
    feature: str
    label: str
    display_value: str
    value: float
    shap: float


class Drivers(BaseModel):
    increasing: list[Driver]
    decreasing: list[Driver]


class PredictResponse(BaseModel):
    risk: float = Field(..., ge=0, le=1, description="Calibrated probability of a credit note within 30 days")
    tier: Literal["Low", "Medium", "High"]
    drivers: Drivers
    base_rate: float
    known_customer: bool
    known_product: bool
    model: str
    explanation_method: str = "Exact TreeSHAP on the uncalibrated model score"


class SimulationRequest(BaseModel):
    scope: Literal["backtest", "open"] = Field("backtest", description="backtest = held-out period with known outcomes; open = still-open window")
    top_percent: float = Field(5.0, gt=0, le=100, description="Target the top X% of order lines by risk")
    effectiveness: float = Field(0.15, ge=0, le=1)
    cost_per_order: float = Field(0.50, ge=0)
    margin: float = Field(0.30, ge=0, le=1)
    conversion_loss: float = Field(0.02, ge=0, le=1)
    handling_cost_per_credit: float = Field(0.0, ge=0)


class SampleSizeRequest(BaseModel):
    baseline: float = Field(..., gt=0, lt=1)
    relative_reduction: float = Field(..., gt=0, lt=1)
    alpha: float = Field(0.05, gt=0, lt=0.5)
    power: float = Field(0.80, gt=0.5, lt=1)
    eligible_orders_per_week: float | None = Field(None, gt=0)
    exposure_share: float = Field(1.0, gt=0, le=1)
