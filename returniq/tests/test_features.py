import numpy as np

from ml import data_prep
from ml.features import FEATURES, build_features
from tests.conftest import raw_rows


def feats_for(rows):
    p, c, _ = data_prep.clean(raw_rows(rows))
    m = data_prep.match_cancellations(p, c)
    t = data_prep.add_target(m)
    return build_features(t, c), t


ROWS = [
    ("1", "10001", 2, "2011-01-01 10:00", 2.0, 1.0, "United Kingdom"),
    ("2", "10001", 2, "2011-01-10 10:00", 2.0, 1.0, "United Kingdom"),
    ("C3", "10001", -2, "2011-01-12 10:00", 2.0, 1.0, "United Kingdom"),
    ("4", "10001", 40, "2011-01-20 10:00", 2.0, 1.0, "United Kingdom"),
    ("5", "10002", 1, "2011-01-20 10:00", 9.0, 7.0, "Germany"),
    ("6", "10002", 1, "2011-01-21 10:00", 9.0, 7.0, "Germany"),
]


def test_all_feature_columns_present_and_finite():
    f, _ = feats_for(ROWS)
    assert set(FEATURES) <= set(f.columns)
    assert np.isfinite(f[FEATURES].to_numpy()).all()


def test_history_features_are_point_in_time():
    f, _ = feats_for(ROWS)
    f = f.set_index("invoice")
    assert f.loc["1", "cust_prior_cancel_lines"] == 0
    assert f.loc["2", "cust_prior_cancel_lines"] == 0
    assert f.loc["4", "cust_prior_cancel_lines"] == 1
    assert f.loc["2", "prod_prior_cancel_rate"] < f.loc["4", "prod_prior_cancel_rate"]


def test_customer_and_order_features():
    f, _ = feats_for(ROWS)
    f = f.set_index("invoice")
    assert f.loc["1", "cust_prior_orders"] == 0 and f.loc["1", "cust_days_since_last_order"] == -1
    assert f.loc["4", "cust_prior_orders"] == 2
    assert abs(f.loc["2", "cust_days_since_last_order"] - 9) < 1e-9
    assert f.loc["1", "order_value"] == 4.0 and f.loc["1", "line_share_of_order"] == 1.0
    assert f.loc["5", "is_uk"] == 0 and f.loc["1", "is_uk"] == 1


def test_label_columns_are_not_model_features():
    for banned in ("y", "cancelled_qty", "first_cancel_date", "lag_days", "cancel_fraction", "invoice", "customer_id", "line_id"):
        assert banned not in FEATURES
