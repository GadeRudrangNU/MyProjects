from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
INTERIM_DIR = ROOT / "data" / "interim"
PROCESSED_DIR = ROOT / "data" / "processed"
MODEL_DIR = ROOT / "ml" / "artifacts"
REPORTS_DIR = ROOT / "reports"

RAW_XLSX = RAW_DIR / "online_retail_II.xlsx"

WINDOW_DAYS = 30

TRAIN_END = "2011-03-31"
VAL_END = "2011-06-30"

RANDOM_STATE = 42
HIGH_RISK_QUANTILE = 0.90
