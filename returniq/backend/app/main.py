from __future__ import annotations

import json
from functools import lru_cache
from typing import Literal

import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from ml import config as ml_config
from ml.features import FEATURE_LABELS, FEATURES
from ml.inference import MODEL_PATH, display_value, get_scorer

from . import experiment, simulation
from .db import engine, get_session
from .models import KV, OrderLine, Product, Segment, Weekly
from .schemas import PredictRequest, PredictResponse, SampleSizeRequest, SimulationRequest

app = FastAPI(
    title="ReturnIQ API",
    version="1.0.0",
    description=("Predict -> Explain -> Intervene -> Measure. Scores purchase lines for the probability of a "
                 "customer credit note (cancellation/return) within 30 days, using the public UCI Online Retail II data. "
                 "The label is a heuristic match of credit notes to purchases - see /api/limitations."),
)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])

LIMITATIONS = [
    {"title": "The target is credit notes, not confirmed returns",
     "body": "Online Retail II has no return flag. It records credit-note invoices (prefix 'C', negative quantity). These can be physical returns, order cancellations, pricing or billing corrections. ReturnIQ therefore predicts 'a credit note will be issued', never 'the customer returned the item'."},
    {"title": "Credit notes are linked to purchases heuristically",
     "body": "Credit notes do not reference the original invoice. We match each one to earlier purchases of the same product by the same customer (most recent first). 91% of credit-note rows and 97% of credited units could be matched; the rest are unmatched and ignored. A match is plausible, not proven."},
    {"title": "Only identified customers are modelled",
     "body": "About 22% of purchase rows have no Customer ID and cannot be linked to credit notes or customer history, so they are excluded. Results may not generalise to guest checkout."},
    {"title": "Wholesale, UK-centric, single retailer",
     "body": "Customers are largely wholesale buyers of gift-ware from one UK retailer (90% of modelled lines are UK). Behaviour differs from consumer fashion retail, where size and fit drive returns. No size, category, review, or reason data exists, so no size guidance is simulated."},
    {"title": "Modest predictive signal; ranking is useful, point predictions are not",
     "body": "Credit notes are rare (~1.6% of lines) and partly driven by factors the data cannot see. The model ranks risk well above chance but most flagged lines are not credited. Use it to prioritise review, not to auto-reject orders."},
    {"title": "Temporal shift and censoring",
     "body": "Models are trained on 2009-12..2011-03, validated on 2011-05..06 and tested on 2011-08..11 (peak season). Performance varies across periods. The last 30 days of the data have an incomplete outcome window and are shown as 'open' without outcomes."},
    {"title": "Simulator and experiment page are projections, not results",
     "body": "The intervention simulator uses user-set assumptions for effectiveness, cost and margin. No intervention was ever run on this data; the A/B experiment is a design artifact. The dataset has no margin or cost fields."},
    {"title": "No exchange or reason analysis",
     "body": "The dataset contains no exchange flag and no cancellation reason, so exchange rate and reason breakdowns are intentionally not shown."},
]


@lru_cache(maxsize=1)
def _kv_observed() -> dict:
    with Session(engine) as s:
        row = s.get(KV, "observed")
        if row is None:
            raise HTTPException(503, "Database not built. Run: python -m backend.build_db")
        return json.loads(row.value)


@lru_cache(maxsize=1)
def _frame() -> pd.DataFrame:
    cols = "line_id, invoice, customer_id, risk, raw_score, tier, line_value, outcome, credited_value, split"
    df = pd.read_sql(text(f"SELECT {cols} FROM order_lines"), engine)
    df["invoice_code"] = pd.factorize(df["invoice"])[0]
    return df


@lru_cache(maxsize=1)
def _metrics() -> dict:
    p = ml_config.REPORTS_DIR / "model_metrics.json"
    if not p.exists():
        raise HTTPException(503, "Model metrics missing. Run: python -m ml.train")
    return json.loads(p.read_text())


def _drivers_for(row_features: dict, compact: dict) -> dict:
    def pack(f: str, s: float) -> dict:
        v = row_features[f]
        return {"feature": f, "label": FEATURE_LABELS[f], "value": v, "display_value": display_value(f, v), "shap": s}
    return {"increasing": [pack(f, s) for f, s in compact["up"]], "decreasing": [pack(f, s) for f, s in compact["down"]]}


def _compact_drivers(rows: list[OrderLine]) -> dict[int, dict]:
    out: dict[int, dict] = {}
    missing = []
    for r in rows:
        if r.drivers_json:
            out[r.line_id] = json.loads(r.drivers_json)
        elif r.line_id in _DRIVER_CACHE:
            out[r.line_id] = _DRIVER_CACHE[r.line_id]
        else:
            missing.append(r)
    if missing:
        sc = get_scorer()
        X = np.array([[json.loads(r.features_json)[f] for f in FEATURES] for r in missing], dtype=float)
        for r, sv in zip(missing, sc.shap_values(X)):
            order = np.argsort(sv)
            comp = {"up": [[FEATURES[i], float(sv[i])] for i in order[::-1][:3] if sv[i] > 0],
                    "down": [[FEATURES[i], float(sv[i])] for i in order[:3] if sv[i] < 0]}
            _DRIVER_CACHE[r.line_id] = out[r.line_id] = comp
    return out


_DRIVER_CACHE: dict[int, dict] = {}


def _order_item(r: OrderLine, with_drivers: bool = True, comp: dict | None = None) -> dict:
    d = {"line_id": r.line_id, "invoice": r.invoice, "invoice_date": r.invoice_date, "customer_id": r.customer_id,
         "stock_code": r.stock_code, "description": r.description, "country": r.country, "quantity": r.quantity,
         "unit_price": r.unit_price, "line_value": r.line_value, "risk": r.risk, "tier": r.tier, "split": r.split,
         "outcome": None if r.outcome is None else int(r.outcome)}
    if with_drivers:
        feats = json.loads(r.features_json)
        comp = comp or {"up": [], "down": []}
        d["top_drivers"] = [{"label": FEATURE_LABELS[f], "display_value": display_value(f, feats[f]), "shap": s}
                            for f, s in comp["up"][:2]]
    return d


@app.get("/api/health", tags=["meta"])
def health() -> dict:
    with Session(engine) as s:
        try:
            n = s.scalar(select(func.count()).select_from(OrderLine))
        except Exception:
            n = None
    return {"status": "ok", "database_ready": bool(n), "scored_order_lines": n, "model_ready": MODEL_PATH.exists()}


@app.get("/api/limitations", tags=["meta"])
def limitations() -> list[dict]:
    return LIMITATIONS


@app.get("/api/filters", tags=["meta"])
def filters(s: Session = Depends(get_session)) -> dict:
    countries = [c for (c,) in s.execute(select(OrderLine.country).group_by(OrderLine.country).order_by(func.count().desc()))]
    return {"countries": countries, "tiers": ["Low", "Medium", "High"], "splits": ["test", "pending"]}


@app.get("/api/metrics", tags=["analytics"])
def metrics(s: Session = Depends(get_session)) -> dict:
    obs = _kv_observed()
    m = _metrics()
    df = _frame()
    weekly = [{k: (None if (isinstance(v, float) and np.isnan(v)) else v) for k, v in r.__dict__.items() if not k.startswith("_")}
              for r in s.scalars(select(Weekly).order_by(Weekly.week))]
    edges = [0, 0.005, 0.01, 0.02, 0.03, 0.05, 0.08, 0.12, 1.01]
    labels = ["<0.5%", "0.5-1%", "1-2%", "2-3%", "3-5%", "5-8%", "8-12%", "12%+"]
    b = pd.cut(df["risk"], edges, labels=labels, right=False)
    dist = []
    for lab in labels:
        g = df[b == lab]
        t = g[g["split"] == "test"]
        dist.append({"bin": lab, "lines": int(len(g)), "observed_rate": float(t["outcome"].mean()) if len(t) else None,
                     "test_lines": int(len(t))})
    tiers = m["tiers"]
    return {
        "observed": obs,
        "model": {k: m[k] for k in ["selected_model", "roc_auc", "pr_auc", "precision", "recall", "f1", "test_samples", "base_rate", "positives", "threshold"]},
        "top_k": m["top_k"], "tiers": tiers, "trend": weekly, "risk_distribution": dist,
    }


@app.get("/api/model/metrics", tags=["model"])
def model_metrics() -> dict:
    return _metrics()


SORTABLE_PRODUCT = {"observed_rate", "value_at_risk", "observed_lines", "avg_risk", "credited_value", "revenue", "scored_lines", "high_risk_lines"}


@app.get("/api/products", tags=["analytics"])
def products(s: Session = Depends(get_session), q: str | None = None, sort: str = "value_at_risk",
             order: Literal["asc", "desc"] = "desc", min_lines: int = Query(0, ge=0),
             limit: int = Query(50, ge=1, le=1000), offset: int = Query(0, ge=0)) -> dict:
    if sort not in SORTABLE_PRODUCT:
        raise HTTPException(400, f"sort must be one of {sorted(SORTABLE_PRODUCT)}")
    stmt = select(Product).where(Product.observed_lines >= min_lines)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(Product.stock_code.ilike(like) | Product.description.ilike(like))
    total = s.scalar(select(func.count()).select_from(stmt.subquery()))
    col = getattr(Product, sort)
    stmt = stmt.order_by(col.desc() if order == "desc" else col.asc()).limit(limit).offset(offset)
    items = [{c.name: getattr(p, c.name) for c in Product.__table__.columns} for p in s.scalars(stmt)]
    return {"total": total, "items": items}


@app.get("/api/segments", tags=["analytics"])
def segments(s: Session = Depends(get_session)) -> list[dict]:
    return [{c.name: getattr(r, c.name) for c in Segment.__table__.columns if c.name != "id"} for r in s.scalars(select(Segment))]


SORTABLE_ORDER = {"risk": OrderLine.risk, "line_value": OrderLine.line_value, "invoice_date": OrderLine.invoice_date,
                  "quantity": OrderLine.quantity}


@app.get("/api/orders", tags=["orders"])
def orders(s: Session = Depends(get_session), tier: str | None = None, q: str | None = None,
           customer_id: int | None = None, stock_code: str | None = None, country: str | None = None,
           min_value: float | None = None, max_value: float | None = None,
           split: Literal["test", "pending"] | None = None,
           sort: str = "risk", order: Literal["asc", "desc"] = "desc",
           limit: int = Query(25, ge=1, le=200), offset: int = Query(0, ge=0)) -> dict:
    if sort not in SORTABLE_ORDER:
        raise HTTPException(400, f"sort must be one of {sorted(SORTABLE_ORDER)}")
    where = []
    if tier:
        tiers = [t for t in tier.split(",") if t in ("Low", "Medium", "High")]
        where.append(OrderLine.tier.in_(tiers))
    if customer_id is not None:
        where.append(OrderLine.customer_id == customer_id)
    if stock_code:
        where.append(OrderLine.stock_code == stock_code.upper())
    if country:
        where.append(OrderLine.country == country)
    if min_value is not None:
        where.append(OrderLine.line_value >= min_value)
    if max_value is not None:
        where.append(OrderLine.line_value <= max_value)
    if split:
        where.append(OrderLine.split == split)
    if q:
        like = f"%{q}%"
        where.append(OrderLine.invoice.ilike(like) | OrderLine.description.ilike(like) | OrderLine.stock_code.ilike(like))
    total = s.scalar(select(func.count()).select_from(OrderLine).where(*where))
    col = SORTABLE_ORDER[sort]
    stmt = select(OrderLine).where(*where).order_by(col.desc() if order == "desc" else col.asc(), OrderLine.raw_score.desc(), OrderLine.line_id).limit(limit).offset(offset)
    rows = list(s.scalars(stmt))
    comps = _compact_drivers(rows)
    return {"total": total, "items": [_order_item(r, comp=comps[r.line_id]) for r in rows]}


@app.get("/api/orders/{line_id}", tags=["orders"])
def order_detail(line_id: int, s: Session = Depends(get_session)) -> dict:
    r = s.get(OrderLine, line_id)
    if r is None:
        raise HTTPException(404, "Order line not found")
    feats = json.loads(r.features_json)
    sc = get_scorer()
    x = np.array([[feats[f] for f in FEATURES]], dtype=float)
    sv = sc.shap_values(x)[0]
    drivers = sc.drivers(x[0], sv, k=5)
    siblings = s.scalars(select(OrderLine).where(OrderLine.invoice == r.invoice).order_by(OrderLine.risk.desc()).limit(50)).all()
    prod = s.get(Product, r.stock_code)
    base = _metrics()["base_rate"]
    return {
        **_order_item(r, with_drivers=False),
        "drivers": drivers,
        "base_rate": base,
        "shap_base_value": float(np.ravel(sc.explainer.expected_value)[-1]),
        "raw_score": r.raw_score,
        "features": [{"feature": f, "label": FEATURE_LABELS[f], "value": feats[f], "display_value": display_value(f, feats[f])} for f in FEATURES],
        "invoice_lines": [_order_item(o, with_drivers=False) for o in siblings],
        "expected_credited_lines": float(sum(o.risk for o in siblings)),
        "invoice_line_count": len(siblings),
        "product": None if prod is None else {c.name: getattr(prod, c.name) for c in Product.__table__.columns},
        "credited_value": r.credited_value,
    }


@app.post("/api/predict", response_model=PredictResponse, tags=["model"])
def predict(req: PredictRequest) -> PredictResponse:
    if not MODEL_PATH.exists():
        raise HTTPException(503, "Model not trained. Run: python -m ml.train")
    sc = get_scorer()
    res = sc.predict_payload(req.model_dump())
    return PredictResponse(risk=res["risk"], tier=res["tier"], drivers=res["drivers"], base_rate=_metrics()["base_rate"],
                           known_customer=res["known_customer"], known_product=res["known_product"], model=sc.name)


@app.post("/api/simulate-intervention", tags=["simulation"])
def simulate_intervention(req: SimulationRequest) -> dict:
    df = _frame()
    pop = df[df["split"] == ("test" if req.scope == "backtest" else "pending")]
    obs = _kv_observed()
    a = simulation.Assumptions(effectiveness=req.effectiveness, cost_per_order=req.cost_per_order, margin=req.margin,
                               conversion_loss=req.conversion_loss, handling_cost_per_credit=req.handling_cost_per_credit,
                               credit_fraction=obs["avg_credit_fraction_of_line"])
    raw = pop["raw_score"].to_numpy()
    risk, val = pop["risk"].to_numpy(), pop["line_value"].to_numpy()
    inv, cust = pop["invoice_code"].to_numpy(), pop["customer_id"].to_numpy()
    mask = simulation.select_top_fraction(raw, req.top_percent / 100.0)
    backtest = req.scope == "backtest"
    res = simulation.simulate(risk, val, inv, cust, mask, a,
                              observed_credited_value=pop["credited_value"].to_numpy() if backtest else None,
                              observed_outcome=pop["outcome"].to_numpy() if backtest else None)
    res["risk_cutoff"] = float(risk[mask].min()) if mask.any() else None
    res["population_lines"] = int(len(pop))
    if backtest:
        res["population_observed_rate"] = float(np.nanmean(pop["outcome"].to_numpy()))
    curve = []
    for pct in (1, 2, 3, 5, 7.5, 10, 15, 20, 30, 40, 50):
        m = simulation.select_top_fraction(raw, pct / 100)
        r = simulation.simulate(risk, val, inv, cust, m, a)
        curve.append({"top_percent": pct, "net_benefit": r["net_benefit"], "targeted_orders": r["targeted_orders"],
                      "returns_prevented": r["returns_prevented"], "intervention_cost": r["intervention_cost"]})
    return {"label": "SIMULATED - projection from user assumptions, not an observed result",
            "scope": req.scope, "assumptions": req.model_dump(), "credit_fraction_used": a.credit_fraction,
            "result": res, "curve": curve}


@app.post("/api/experiment/sample-size", tags=["simulation"])
def sample_size(req: SampleSizeRequest) -> dict:
    out = experiment.sample_size_per_arm(req.baseline, req.relative_reduction, req.alpha, req.power)
    if req.eligible_orders_per_week:
        out["weeks_to_enrol"] = experiment.duration_weeks(out["n_per_arm"], req.eligible_orders_per_week, req.exposure_share)
    return out
