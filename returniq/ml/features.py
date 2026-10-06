from __future__ import annotations

import numpy as np
import pandas as pd

SMOOTHING = 20.0

FEATURES = [
    "quantity", "unit_price", "line_value",
    "order_lines", "order_units", "order_value", "line_share_of_order",
    "month", "day_of_week", "hour", "is_uk",
    "cust_prior_orders", "cust_prior_spend", "cust_days_since_last_order", "cust_tenure_days",
    "cust_prior_cancel_lines", "cust_prior_cancel_rate",
    "prod_prior_lines", "prod_prior_cancel_rate", "prod_qty_ratio", "prod_price_ratio",
    "unusual_quantity", "unusual_price",
]

FEATURE_LABELS = {
    "quantity": "Quantity ordered",
    "unit_price": "Unit price",
    "line_value": "Line value",
    "order_lines": "Distinct products in order",
    "order_units": "Total units in order",
    "order_value": "Total order value",
    "line_share_of_order": "Line share of order value",
    "month": "Order month",
    "day_of_week": "Day of week",
    "hour": "Hour of day",
    "is_uk": "Domestic (UK) order",
    "cust_prior_orders": "Customer's prior orders",
    "cust_prior_spend": "Customer's prior spend",
    "cust_days_since_last_order": "Days since customer's last order",
    "cust_tenure_days": "Customer tenure (days)",
    "cust_prior_cancel_lines": "Customer's prior credit-note lines",
    "cust_prior_cancel_rate": "Customer's historical credit-note rate",
    "prod_prior_lines": "Product's prior sales volume",
    "prod_prior_cancel_rate": "Product's historical credit-note rate",
    "prod_qty_ratio": "Quantity vs. product's typical quantity",
    "prod_price_ratio": "Price vs. product's typical price",
    "unusual_quantity": "Unusually large quantity for this product",
    "unusual_price": "Unusual price for this product",
}


def _smooth(events: np.ndarray, exposure: np.ndarray, base: float) -> np.ndarray:
    return np.minimum((events + SMOOTHING * base) / (exposure + SMOOTHING), 1.0)


def _asof_counts(keys_lines: pd.Series, dates_lines: np.ndarray, keys_ev: pd.Series,
                 dates_ev: np.ndarray) -> np.ndarray:
    out = np.zeros(len(keys_lines))
    ev_by_key = {k: np.sort(v) for k, v in
                 pd.Series(dates_ev).groupby(keys_ev.to_numpy()).__iter__()}
    line_groups = pd.Series(np.arange(len(keys_lines))).groupby(keys_lines.to_numpy())
    for k, idx in line_groups:
        ev = ev_by_key.get(k)
        if ev is None:
            continue
        out[idx.to_numpy()] = np.searchsorted(ev, dates_lines[idx.to_numpy()], side="left")
    return out


def build_features(purchases: pd.DataFrame, cancels: pd.DataFrame,
                   base_rate: float | None = None) -> pd.DataFrame:
    df = purchases.copy()
    dates = df["invoice_date"].to_numpy().astype("datetime64[ns]")
    base = float(base_rate if base_rate is not None else len(cancels) / max(len(df), 1))

    inv = df.groupby("invoice")
    df["order_lines"] = inv["line_id"].transform("count")
    df["order_units"] = inv["quantity"].transform("sum")
    df["order_value"] = inv["line_value"].transform("sum")
    df["line_share_of_order"] = df["line_value"] / df["order_value"]

    df["month"] = df["invoice_date"].dt.month
    df["day_of_week"] = df["invoice_date"].dt.dayofweek
    df["hour"] = df["invoice_date"].dt.hour
    df["is_uk"] = (df["country"] == "United Kingdom").astype(int)

    orders = (df.groupby(["customer_id", "invoice"], as_index=False)
                .agg(inv_date=("invoice_date", "min"), inv_value=("line_value", "sum")))
    orders = orders.sort_values(["customer_id", "inv_date", "invoice"])
    g = orders.groupby("customer_id")
    orders["cust_prior_orders"] = g.cumcount()
    orders["cust_prior_spend"] = g["inv_value"].cumsum() - orders["inv_value"]
    prev = g["inv_date"].shift(1)
    orders["cust_days_since_last_order"] = ((orders["inv_date"] - prev).dt.total_seconds() / 86400).fillna(-1)
    first = g["inv_date"].transform("min")
    orders["cust_tenure_days"] = (orders["inv_date"] - first).dt.total_seconds() / 86400
    df = df.merge(orders[["invoice", "customer_id", "cust_prior_orders", "cust_prior_spend",
                          "cust_days_since_last_order", "cust_tenure_days"]],
                  on=["invoice", "customer_id"], how="left")

    c_dates = cancels["invoice_date"].to_numpy().astype("datetime64[ns]")
    df["cust_prior_cancel_lines"] = _asof_counts(df["customer_id"], dates, cancels["customer_id"], c_dates)
    cust_prior_lines = _asof_counts(df["customer_id"], dates, df["customer_id"], dates)
    df["cust_prior_cancel_rate"] = _smooth(df["cust_prior_cancel_lines"].to_numpy(), cust_prior_lines, base)

    df["prod_prior_lines"] = _asof_counts(df["stock_code"], dates, df["stock_code"], dates)
    prod_prior_cancels = _asof_counts(df["stock_code"], dates, cancels["stock_code"], c_dates)
    df["prod_prior_cancel_rate"] = _smooth(prod_prior_cancels, df["prod_prior_lines"].to_numpy(), base)

    order = np.lexsort((df["line_id"].to_numpy(), df["stock_code"].to_numpy()))
    s = df.iloc[order]
    gp = s.groupby("stock_code")
    n_prior = gp.cumcount().to_numpy()
    prior_qty = (gp["quantity"].cumsum() - s["quantity"]).to_numpy()
    prior_price = (gp["unit_price"].cumsum() - s["unit_price"]).to_numpy()
    with np.errstate(divide="ignore", invalid="ignore"):
        qty_ratio = np.where(n_prior > 0, s["quantity"].to_numpy() / (prior_qty / n_prior), 1.0)
        price_ratio = np.where(n_prior > 0, s["unit_price"].to_numpy() / (prior_price / n_prior), 1.0)
    df.loc[s.index, "prod_qty_ratio"] = qty_ratio
    df.loc[s.index, "prod_price_ratio"] = price_ratio
    enough = df["prod_prior_lines"] >= 5
    df["unusual_quantity"] = ((df["prod_qty_ratio"] > 3.0) & enough).astype(int)
    df["unusual_price"] = (((df["prod_price_ratio"] > 1.5) | (df["prod_price_ratio"] < 1 / 1.5)) & enough).astype(int)

    df[FEATURES] = df[FEATURES].replace([np.inf, -np.inf], np.nan).fillna(0.0)
    return df
