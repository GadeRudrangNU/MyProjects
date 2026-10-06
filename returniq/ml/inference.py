from __future__ import annotations

from functools import lru_cache

import joblib
import numpy as np
import pandas as pd

from . import config
from .features import FEATURE_LABELS, FEATURES, SMOOTHING

HISTORY_PATH = config.MODEL_DIR / "history.joblib"
MODEL_PATH = config.MODEL_DIR / "model.joblib"


def display_value(feature: str, v: float) -> str:
    if feature in ("is_uk", "unusual_quantity", "unusual_price"):
        return "Yes" if v >= 0.5 else "No"
    if feature in ("cust_prior_cancel_rate", "prod_prior_cancel_rate"):
        return f"{v * 100:.1f}%"
    if feature in ("unit_price", "line_value", "order_value", "cust_prior_spend"):
        return f"£{v:,.2f}"
    if feature in ("prod_qty_ratio", "prod_price_ratio"):
        return f"{v:.2f}x"
    if feature == "cust_days_since_last_order":
        return "First order" if v < 0 else f"{v:,.0f} days"
    if feature == "cust_tenure_days":
        return f"{v:,.0f} days"
    return f"{v:,.0f}" if float(v).is_integer() or abs(v) >= 100 else f"{v:,.2f}"


class Scorer:
    def __init__(self) -> None:
        art = joblib.load(MODEL_PATH)
        self.model, self.calibrator = art["model"], art["calibrator"]
        self.cuts, self.threshold, self.name = art["cuts"], art["threshold"], art["name"]
        self.medians = art["medians"]
        self.history = joblib.load(HISTORY_PATH) if HISTORY_PATH.exists() else None
        self._explainer = None

    def score(self, X: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        raw = self.model.predict_proba(X)[:, 1]
        risk = self.calibrator.predict(raw)
        tier = np.where(raw >= self.cuts["raw_high"], "High", np.where(raw >= self.cuts["raw_medium"], "Medium", "Low"))
        return raw, risk, tier

    @property
    def explainer(self):
        if self._explainer is None:
            import shap
            self._explainer = shap.TreeExplainer(self.model)
        return self._explainer

    def shap_values(self, X: np.ndarray) -> np.ndarray:
        v = self.explainer.shap_values(X, check_additivity=False)
        v = np.asarray(v)
        if v.ndim == 3:
            v = v[:, :, 1]
        return v

    def drivers(self, x_row: np.ndarray, shap_row: np.ndarray, k: int = 3) -> dict:
        order = np.argsort(shap_row)
        def pack(i: int) -> dict:
            f = FEATURES[i]
            return {"feature": f, "label": FEATURE_LABELS[f], "value": float(x_row[i]),
                    "display_value": display_value(f, float(x_row[i])), "shap": float(shap_row[i])}
        up = [pack(i) for i in order[::-1][:k] if shap_row[i] > 0]
        down = [pack(i) for i in order[:k] if shap_row[i] < 0]
        return {"increasing": up, "decreasing": down}

    def features_from_payload(self, p: dict) -> dict:
        h = self.history or {"customers": {}, "products": {}, "base_rate": 0.02, "as_of": pd.Timestamp("2011-12-09")}
        when = pd.Timestamp(p.get("invoice_date") or h["as_of"])
        qty, price = float(p["quantity"]), float(p["unit_price"])
        line_value = qty * price
        order_lines = int(p.get("order_lines") or 1)
        order_value = float(p.get("order_value") or line_value)
        order_units = float(p.get("order_units") or qty)
        order_value = max(order_value, line_value)
        c = h["customers"].get(p.get("customer_id")) if p.get("customer_id") is not None else None
        pr = h["products"].get(str(p["stock_code"]).strip().upper())
        base = h["base_rate"]
        f = {
            "quantity": qty, "unit_price": price, "line_value": line_value,
            "order_lines": order_lines, "order_units": max(order_units, qty), "order_value": order_value,
            "line_share_of_order": line_value / order_value if order_value else 1.0,
            "month": when.month, "day_of_week": when.dayofweek, "hour": when.hour,
            "is_uk": int(p.get("country", "United Kingdom") == "United Kingdom"),
        }
        if c:
            days = (when - c["last_order"]).total_seconds() / 86400
            f.update(cust_prior_orders=c["orders"], cust_prior_spend=c["spend"],
                     cust_days_since_last_order=max(days, 0.0),
                     cust_tenure_days=max((when - c["first_order"]).total_seconds() / 86400, 0.0),
                     cust_prior_cancel_lines=c["cancel_lines"],
                     cust_prior_cancel_rate=min((c["cancel_lines"] + SMOOTHING * base) / (c["lines"] + SMOOTHING), 1.0))
        else:
            f.update(cust_prior_orders=0, cust_prior_spend=0.0, cust_days_since_last_order=-1.0, cust_tenure_days=0.0,
                     cust_prior_cancel_lines=0, cust_prior_cancel_rate=min(base, 1.0))
        if pr:
            n = pr["lines"]
            qr = qty / (pr["sum_qty"] / n) if n else 1.0
            prr = price / (pr["sum_price"] / n) if n else 1.0
            f.update(prod_prior_lines=n,
                     prod_prior_cancel_rate=min((pr["cancel_lines"] + SMOOTHING * base) / (n + SMOOTHING), 1.0),
                     prod_qty_ratio=qr, prod_price_ratio=prr)
            enough = n >= 5
        else:
            f.update(prod_prior_lines=0, prod_prior_cancel_rate=min(base, 1.0), prod_qty_ratio=1.0, prod_price_ratio=1.0)
            enough = False
        f["unusual_quantity"] = int(f["prod_qty_ratio"] > 3.0 and enough)
        f["unusual_price"] = int((f["prod_price_ratio"] > 1.5 or f["prod_price_ratio"] < 1 / 1.5) and enough)
        return f

    def predict_payload(self, p: dict) -> dict:
        f = self.features_from_payload(p)
        x = np.array([[f[c] for c in FEATURES]], dtype=float)
        raw, risk, tier = self.score(x)
        sv = self.shap_values(x)[0]
        return {"risk": float(risk[0]), "raw_score": float(raw[0]), "tier": str(tier[0]),
                "features": f, "drivers": self.drivers(x[0], sv),
                "known_customer": bool(self.history and p.get("customer_id") in self.history["customers"]),
                "known_product": bool(self.history and str(p["stock_code"]).strip().upper() in self.history["products"])}


@lru_cache(maxsize=1)
def get_scorer() -> Scorer:
    return Scorer()
