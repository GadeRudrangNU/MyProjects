import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def raw_rows(rows):
    return pd.DataFrame(rows, columns=["Invoice", "StockCode", "Quantity", "InvoiceDate", "Price", "Customer ID", "Country"]).assign(
        Description="WIDGET", InvoiceDate=lambda d: pd.to_datetime(d["InvoiceDate"]))


@pytest.fixture
def mini_raw():
    return raw_rows([
        ("1001", "10001", 10, "2011-01-01 10:00", 2.0, 1.0, "United Kingdom"),
        ("1001", "10002", 5, "2011-01-01 10:00", 3.0, 1.0, "United Kingdom"),
        ("1001", "10002", 5, "2011-01-01 10:00", 3.0, 1.0, "United Kingdom"),
        ("C2001", "10001", -4, "2011-01-06 12:00", 2.0, 1.0, "United Kingdom"),
        ("1002", "10003", 3, "2011-01-02 09:00", 4.0, 2.0, "France"),
        ("C2002", "10003", -3, "2011-03-15 09:00", 4.0, 2.0, "France"),
        ("1003", "POST", 1, "2011-01-03 09:00", 18.0, 1.0, "United Kingdom"),
        ("1004", "10004", 2, "2011-01-04 09:00", 5.0, None, "United Kingdom"),
        ("1005", "10005", 1, "2011-01-05 09:00", 0.0, 1.0, "United Kingdom"),
        ("1006", "10006", 2, "2011-06-01 09:00", 5.0, 3.0, "United Kingdom"),
        ("1007", "10006", 2, "2011-06-20 09:00", 5.0, 3.0, "United Kingdom"),
        ("C2003", "10006", -3, "2011-06-25 09:00", 5.0, 3.0, "United Kingdom"),
        ("1008", "10007", 1, "2011-12-09 09:00", 5.0, 4.0, "United Kingdom"),
    ])
