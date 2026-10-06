from __future__ import annotations

import re
from collections import defaultdict

import numpy as np
import pandas as pd

from . import config

PRODUCT_CODE = re.compile(r"^\d{5}")


def load_raw() -> pd.DataFrame:
    config.INTERIM_DIR.mkdir(parents=True, exist_ok=True)
    cache = config.INTERIM_DIR / "raw_combined.parquet"
    if cache.exists():
        return pd.read_parquet(cache)
    sheets = pd.read_excel(config.RAW_XLSX, sheet_name=None)
    df = pd.concat(sheets.values(), ignore_index=True)
    df["Invoice"] = df["Invoice"].astype(str)
    df["StockCode"] = df["StockCode"].astype(str)
    df["Description"] = df["Description"].astype("string")
    df.to_parquet(cache)
    return df


def standardise(df: pd.DataFrame) -> pd.DataFrame:
    out = df.rename(columns={
        "Invoice": "invoice", "StockCode": "stock_code", "Description": "description",
        "Quantity": "quantity", "InvoiceDate": "invoice_date", "Price": "unit_price",
        "Customer ID": "customer_id", "Country": "country",
    }).copy()
    out["invoice"] = out["invoice"].astype(str)
    out["stock_code"] = out["stock_code"].astype(str).str.strip().str.upper()
    return out


def clean(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    df = standardise(df)
    stats: dict = {"raw_rows": int(len(df))}

    before = len(df)
    df = df.drop_duplicates().reset_index(drop=True)
    stats["exact_duplicates_removed"] = int(before - len(df))

    is_credit = df["invoice"].str.startswith("C")
    stats["credit_note_rows"] = int(is_credit.sum())
    stats["non_credit_negative_quantity_rows"] = int(((df["quantity"] < 0) & ~is_credit).sum())
    stats["non_credit_zero_or_negative_price_rows"] = int(((df["unit_price"] <= 0) & ~is_credit).sum())

    is_product = df["stock_code"].str.match(PRODUCT_CODE)
    stats["non_product_code_rows"] = int((~is_product).sum())

    cancels = df[is_credit & is_product & (df["quantity"] < 0) & (df["unit_price"] > 0)].copy()
    cancels["quantity"] = -cancels["quantity"]
    stats["credit_note_product_rows"] = int(len(cancels))
    stats["credit_note_rows_missing_customer"] = int(cancels["customer_id"].isna().sum())

    purchases = df[~is_credit & is_product & (df["quantity"] > 0) & (df["unit_price"] > 0)].copy()
    stats["purchase_rows_valid"] = int(len(purchases))
    stats["purchase_rows_missing_customer"] = int(purchases["customer_id"].isna().sum())

    purchases = purchases.dropna(subset=["customer_id"])
    cancels = cancels.dropna(subset=["customer_id"])
    purchases["customer_id"] = purchases["customer_id"].astype(int)
    cancels["customer_id"] = cancels["customer_id"].astype(int)
    purchases["line_value"] = purchases["quantity"] * purchases["unit_price"]
    cancels["line_value"] = cancels["quantity"] * cancels["unit_price"]
    purchases = purchases.sort_values(["invoice_date", "invoice"]).reset_index(drop=True)
    purchases.insert(0, "line_id", np.arange(len(purchases)))
    cancels = cancels.sort_values("invoice_date").reset_index(drop=True)
    stats["purchase_rows_modelled"] = int(len(purchases))
    stats["credit_note_rows_modelled"] = int(len(cancels))
    return purchases, cancels, stats


def match_cancellations(purchases: pd.DataFrame, cancels: pd.DataFrame) -> pd.DataFrame:
    p = purchases
    p_date = p["invoice_date"].to_numpy()
    p_qty = p["quantity"].to_numpy().astype(float)
    remaining = p_qty.copy()
    cancelled_qty = np.zeros(len(p))
    first_cancel = np.full(len(p), np.datetime64("NaT"), dtype="datetime64[ns]")

    groups: dict[tuple[int, str], list[int]] = defaultdict(list)
    for idx, (c, s) in enumerate(zip(p["customer_id"].to_numpy(), p["stock_code"].to_numpy())):
        groups[(c, s)].append(idx)

    matched_credit_rows = 0
    credit_qty_total = 0.0
    credit_qty_matched = 0.0
    for c, s, qty, dt in zip(cancels["customer_id"], cancels["stock_code"],
                             cancels["quantity"], cancels["invoice_date"].to_numpy()):
        credit_qty_total += qty
        idxs = groups.get((c, s))
        if not idxs:
            continue
        need = float(qty)
        hit = False
        for i in reversed(idxs):
            if p_date[i] > dt or remaining[i] <= 0:
                continue
            take = min(need, remaining[i])
            remaining[i] -= take
            cancelled_qty[i] += take
            credit_qty_matched += take
            if np.isnat(first_cancel[i]) or dt < first_cancel[i]:
                first_cancel[i] = dt
            need -= take
            hit = True
            if need <= 0:
                break
        matched_credit_rows += hit

    out = p.copy()
    out["cancelled_qty"] = cancelled_qty
    out["first_cancel_date"] = pd.to_datetime(first_cancel)
    out["lag_days"] = (out["first_cancel_date"] - out["invoice_date"]).dt.total_seconds() / 86400
    out.attrs["matching"] = {
        "credit_rows_total": int(len(cancels)),
        "credit_rows_with_match": int(matched_credit_rows),
        "credit_units_total": float(credit_qty_total),
        "credit_units_matched": float(credit_qty_matched),
    }
    return out


def add_target(matched: pd.DataFrame, window_days: int = config.WINDOW_DAYS) -> pd.DataFrame:
    out = matched.copy()
    end = out["invoice_date"].max()
    out["observable"] = out["invoice_date"] <= end - pd.Timedelta(days=window_days)
    out["y"] = (out["lag_days"].notna() & (out["lag_days"] <= window_days)).astype(int)
    out["cancel_fraction"] = (out["cancelled_qty"] / out["quantity"]).clip(upper=1.0)
    return out


def build_labelled_purchases() -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    raw = load_raw()
    purchases, cancels, stats = clean(raw)
    matched = match_cancellations(purchases, cancels)
    labelled = add_target(matched)
    stats["matching"] = matched.attrs["matching"]
    return labelled, cancels, stats
