from __future__ import annotations

import json
import time

import joblib
import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from sqlalchemy import text

from ml import config
from ml.features import FEATURES
from ml.inference import HISTORY_PATH, get_scorer
from ml.train import chronological_split

from .app import models  # noqa: F401  (registers tables on Base.metadata)
from .app.db import Base, engine

TOP_K = 3


def _shap_chunk(X: np.ndarray) -> list[str]:
    sc = get_scorer()
    sv = sc.shap_values(X)
    out = []
    for xi, si in zip(X, sv):
        order = np.argsort(si)
        up = [[FEATURES[i], round(float(si[i]), 5)] for i in order[::-1][:TOP_K] if si[i] > 0]
        down = [[FEATURES[i], round(float(si[i]), 5)] for i in order[:TOP_K] if si[i] < 0]
        out.append(json.dumps({"up": up, "down": down}))
    return out


def build_history(feats: pd.DataFrame, cancels: pd.DataFrame) -> dict:
    as_of = feats["invoice_date"].max()
    cust_inv = feats.groupby(["customer_id", "invoice"]).agg(d=("invoice_date", "min"), v=("line_value", "sum")).reset_index()
    cg = cust_inv.groupby("customer_id").agg(orders=("invoice", "count"), spend=("v", "sum"),
                                              first=("d", "min"), last=("d", "max"))
    c_lines = feats.groupby("customer_id").size()
    c_cancel = cancels.groupby("customer_id").size()
    customers = {int(k): {"orders": int(r.orders), "spend": float(r.spend), "first_order": r["first"], "last_order": r["last"],
                          "lines": int(c_lines[k]), "cancel_lines": int(c_cancel.get(k, 0))} for k, r in cg.iterrows()}
    pg = feats.groupby("stock_code").agg(lines=("line_id", "count"), sum_qty=("quantity", "sum"), sum_price=("unit_price", "sum"))
    p_cancel = cancels.groupby("stock_code").size()
    products = {k: {"lines": int(r.lines), "sum_qty": float(r.sum_qty), "sum_price": float(r.sum_price),
                    "cancel_lines": int(p_cancel.get(k, 0))} for k, r in pg.iterrows()}
    return {"customers": customers, "products": products, "base_rate": len(cancels) / len(feats), "as_of": as_of}


def segments_table(df: pd.DataFrame) -> pd.DataFrame:
    d = df.copy()
    d["cust_segment"] = pd.cut(d["cust_prior_orders"], [-1, 0, 4, 19, 10**6],
                               labels=["New (first order)", "Early (1-4 prior orders)", "Established (5-19)", "Loyal (20+)"]).astype(str)
    d["price_band"] = pd.cut(d["unit_price"], [0, 1, 3, 8, 10**6], labels=["< £1", "£1-3", "£3-8", "£8+"]).astype(str)
    d["qty_band"] = pd.cut(d["quantity"], [0, 1, 6, 24, 10**7], labels=["1 unit", "2-6 units", "7-24 units", "25+ units"]).astype(str)
    d["country_group"] = np.where(d["country"] == "United Kingdom", "United Kingdom", "International")
    d["order_size"] = pd.cut(d["order_lines"], [0, 5, 20, 50, 10**5], labels=["1-5 products", "6-20 products", "21-50 products", "51+ products"]).astype(str)
    rows = []
    for dim, col in [("Customer maturity", "cust_segment"), ("Unit price band", "price_band"),
                     ("Quantity per line", "qty_band"), ("Market", "country_group"), ("Order size", "order_size")]:
        for seg, g in d.groupby(col):
            obs = g[g["observable"]]
            sc = g[g["scored"]]
            rows.append({"dimension": dim, "segment": seg, "lines": int(len(g)), "observed_lines": int(len(obs)),
                         "credited_lines": int(obs["y"].sum()), "observed_rate": float(obs["y"].mean()) if len(obs) else None,
                         "scored_lines": int(len(sc)), "avg_risk": float(sc["risk"].mean()) if len(sc) else None,
                         "value_at_risk": float((sc["risk"] * sc["line_value"]).sum()) if len(sc) else 0.0,
                         "revenue": float(g["line_value"].sum())})
    return pd.DataFrame(rows)


def main() -> None:
    t0 = time.time()
    feats = pd.read_parquet(config.INTERIM_DIR / "features.parquet")
    from ml import data_prep
    _, cancels, _ = data_prep.build_labelled_purchases()
    sc = get_scorer()

    splits = chronological_split(feats)
    scored_mask = feats["line_id"].isin(set(splits["test"]["line_id"]) | set(splits["pending"]["line_id"]))
    feats["scored"] = scored_mask
    S = feats[scored_mask].copy()
    X = S[FEATURES].to_numpy(dtype=float)
    raw, risk, tier = sc.score(X)
    S["raw_score"], S["risk"], S["tier"] = raw, risk, tier
    feats["risk"] = np.nan
    feats.loc[S.index, "risk"] = risk
    print(f"scored {len(S):,} lines in {time.time() - t0:.0f}s; computing SHAP ...")

    need = np.flatnonzero(tier != "Low")
    chunks = [X[need[i:i + 1000]] for i in range(0, len(need), 1000)]
    drivers = Parallel(n_jobs=12, verbose=0)(delayed(_shap_chunk)(c) for c in chunks)
    drv = np.full(len(X), "", dtype=object)
    drv[need] = [d for ch in drivers for d in ch]
    S["drivers_json"] = drv
    print(f"SHAP done at {time.time() - t0:.0f}s")

    S["split"] = np.where(S["observable"], "test", "pending")
    S["outcome"] = np.where(S["observable"], S["y"], np.nan)
    S["credited_value"] = np.where(S["y"] == 1, S["cancelled_qty"].clip(upper=S["quantity"]) * S["unit_price"], 0.0)
    S["features_json"] = [json.dumps({f: float(v) for f, v in zip(FEATURES, row)}) for row in X]
    S["invoice_date"] = S["invoice_date"].dt.strftime("%Y-%m-%d %H:%M:%S")

    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    cols = ["line_id", "invoice", "customer_id", "stock_code", "description", "country", "invoice_date", "quantity",
            "unit_price", "line_value", "risk", "raw_score", "tier", "outcome", "credited_value", "split",
            "features_json", "drivers_json"]
    S[cols].to_sql("order_lines", engine, if_exists="append", index=False, chunksize=20000)
    with engine.begin() as con:
        con.execute(text("CREATE INDEX IF NOT EXISTS ix_ol_risk ON order_lines(risk)"))

    obs_all = feats[feats["observable"]].copy()
    obs_all["credited_value"] = np.where(obs_all["y"] == 1, obs_all["cancelled_qty"].clip(upper=obs_all["quantity"]) * obs_all["unit_price"], 0.0)
    desc = feats.sort_values("invoice_date").groupby("stock_code")["description"].last()
    pa = obs_all.groupby("stock_code").agg(observed_lines=("y", "size"), credited_lines=("y", "sum"),
                                           revenue=("line_value", "sum"), credited_value=("credited_value", "sum"),
                                           units=("quantity", "sum"))
    ps = S.groupby("stock_code").agg(scored_lines=("risk", "size"), avg_risk=("risk", "mean"),
                                     high_risk_lines=("tier", lambda s: int((s == "High").sum())))
    ps["value_at_risk"] = (S["risk"] * S["line_value"]).groupby(S["stock_code"]).sum()
    prod = pa.join(ps, how="left").fillna({"scored_lines": 0, "avg_risk": 0, "high_risk_lines": 0, "value_at_risk": 0})
    prod["observed_rate"] = prod["credited_lines"] / prod["observed_lines"]
    prod["description"] = desc.reindex(prod.index)
    prod = prod.reset_index().rename(columns={"index": "stock_code"})
    prod.to_sql("products", engine, if_exists="append", index=False)

    feats["week"] = feats["invoice_date"].dt.to_period("W-SUN").dt.start_time
    wk = feats.groupby("week").apply(lambda g: pd.Series({
        "lines": len(g), "observed_lines": int(g["observable"].sum()),
        "credited_lines": int(g.loc[g["observable"], "y"].sum()),
        "scored_lines": int(g["scored"].sum()),
        "avg_risk": float(g.loc[g["scored"], "risk"].mean()) if g["scored"].any() else np.nan,
        "revenue": float(g["line_value"].sum())}), include_groups=False).reset_index()
    wk["observed_rate"] = np.where(wk["observed_lines"] > 0, wk["credited_lines"] / wk["observed_lines"].clip(lower=1), np.nan)
    wk["week"] = wk["week"].dt.strftime("%Y-%m-%d")
    wk.loc[wk["observed_lines"] < 0.7 * wk["lines"], "observed_rate"] = np.nan
    wk.to_sql("weekly", engine, if_exists="append", index=False)

    segments_table(feats).to_sql("segments", engine, if_exists="append", index=False)

    inv = obs_all.groupby("invoice").agg(v=("line_value", "sum"), any_credit=("y", "max"), cust=("customer_id", "first"))
    cust_orders = obs_all.groupby("customer_id")["invoice"].nunique()
    pos = obs_all[obs_all["y"] == 1]
    credit_frac = float((pos["cancelled_qty"].clip(upper=pos["quantity"]) / pos["quantity"]).mean())
    prep = json.loads((config.REPORTS_DIR / "data_prep_stats.json").read_text())
    pending = S[S["split"] == "pending"]
    test = S[S["split"] == "test"]
    observed = {
        "period": [str(feats["invoice_date"].min()), str(feats["invoice_date"].max())],
        "purchase_lines_modelled": int(len(feats)), "invoices_total": int(feats["invoice"].nunique()),
        "customers": int(feats["customer_id"].nunique()), "products": int(feats["stock_code"].nunique()),
        "observable_lines": int(len(obs_all)), "credited_lines_30d": int(obs_all["y"].sum()),
        "line_credit_rate_30d": float(obs_all["y"].mean()),
        "retained_purchase_rate_30d_lines": float(1 - obs_all["y"].mean()),
        "order_credit_rate_30d": float(inv["any_credit"].mean()),
        "retained_purchase_rate_30d_orders": float(1 - inv["any_credit"].mean()),
        "revenue_observable": float(obs_all["line_value"].sum()),
        "credited_value_30d": float(obs_all["credited_value"].sum()),
        "value_credit_rate_30d": float(obs_all["credited_value"].sum() / obs_all["line_value"].sum()),
        "avg_credit_fraction_of_line": credit_frac,
        "avg_order_value": float(inv["v"].mean()), "median_order_value": float(inv["v"].median()),
        "repeat_customer_rate": float((cust_orders >= 2).mean()), "orders_per_customer_mean": float(cust_orders.mean()),
        "exchange_rate": None,
        "exchange_rate_note": "Not measurable: the dataset has no exchange / replacement flag.",
        "reasons_available": False,
        "reasons_note": "Not available: credit notes carry no reason code, so return/cancellation reasons cannot be analysed.",
        "scored": {"test_lines": int(len(test)), "pending_lines": int(len(pending)),
                   "test_period": [test["invoice_date"].min(), test["invoice_date"].max()],
                   "pending_period": [pending["invoice_date"].min(), pending["invoice_date"].max()],
                   "high_risk_rate_test": float((test["tier"] == "High").mean()),
                   "high_risk_lines_pending": int((pending["tier"] == "High").sum()),
                   "value_at_risk_pending": float((pending["risk"] * pending["line_value"] * credit_frac).sum()),
                   "value_at_risk_test_expected": float((test["risk"] * test["line_value"] * credit_frac).sum()),
                   "credited_value_test_observed": float(test["credited_value"].sum()),
                   "avg_risk_test": float(test["risk"].mean()), "observed_rate_test": float(test["outcome"].mean()),
                   "orders_pending": int(pending["invoice"].nunique()),
                   "orders_test": int(test["invoice"].nunique()),
                   "weekly_orders_test_mean": float(test.groupby(pd.to_datetime(test["invoice_date"]).dt.to_period("W"))["invoice"].nunique().iloc[1:-1].mean())},
        "data_prep": prep,
    }
    with engine.begin() as con:
        con.execute(text("INSERT INTO kv(key, value) VALUES (:k, :v)"), {"k": "observed", "v": json.dumps(observed, default=str)})

    joblib.dump(build_history(feats, cancels), HISTORY_PATH)
    print(f"DB built in {time.time() - t0:.0f}s -> {engine.url}")


if __name__ == "__main__":
    main()
