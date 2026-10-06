import pandas as pd

from ml import data_prep


def build(mini_raw):
    purchases, cancels, stats = data_prep.clean(mini_raw)
    matched = data_prep.match_cancellations(purchases, cancels)
    return purchases, cancels, stats, data_prep.add_target(matched)


def test_clean_removes_duplicates_and_non_product_rows(mini_raw):
    purchases, cancels, stats = data_prep.clean(mini_raw)
    assert stats["exact_duplicates_removed"] == 1
    assert stats["non_product_code_rows"] == 1
    assert stats["purchase_rows_missing_customer"] == 1
    assert "POST" not in set(purchases["stock_code"])
    assert purchases["customer_id"].notna().all()
    assert (purchases["unit_price"] > 0).all() and (purchases["quantity"] > 0).all()


def test_credit_notes_are_separated_and_made_positive(mini_raw):
    purchases, cancels, _ = data_prep.clean(mini_raw)
    assert len(cancels) == 3
    assert (cancels["quantity"] > 0).all()
    assert not purchases["invoice"].str.startswith("C").any()


def test_target_within_window_is_positive_with_correct_lag(mini_raw):
    *_, t = build(mini_raw)
    row = t[(t["customer_id"] == 1) & (t["stock_code"] == "10001")].iloc[0]
    assert row["y"] == 1
    assert row["cancelled_qty"] == 4
    assert abs(row["lag_days"] - (5 + 2 / 24)) < 1e-6


def test_credit_outside_window_is_not_positive(mini_raw):
    *_, t = build(mini_raw)
    row = t[t["customer_id"] == 2].iloc[0]
    assert row["lag_days"] > 30 and row["y"] == 0


def test_credit_consumes_most_recent_purchase_first(mini_raw):
    *_, t = build(mini_raw)
    r = t[t["customer_id"] == 3].sort_values("invoice_date")
    assert list(r["cancelled_qty"]) == [1, 2]
    assert list(r["y"]) == [0, 1] or list(r["y"]) == [1, 1]
    assert r.iloc[1]["y"] == 1


def test_credit_before_purchase_never_matches():
    from tests.conftest import raw_rows
    raw = raw_rows([("C9", "10001", -1, "2011-01-01 09:00", 2.0, 1.0, "United Kingdom"),
                    ("10", "10001", 1, "2011-01-02 09:00", 2.0, 1.0, "United Kingdom")])
    p, c, _ = data_prep.clean(raw)
    m = data_prep.match_cancellations(p, c)
    assert m["cancelled_qty"].sum() == 0


def test_right_censoring_marks_recent_purchases_unobservable(mini_raw):
    *_, t = build(mini_raw)
    last = t[t["customer_id"] == 4].iloc[0]
    assert not last["observable"]
    assert t[t["customer_id"] == 1]["observable"].all()
    assert isinstance(t["invoice_date"].iloc[0], pd.Timestamp)
