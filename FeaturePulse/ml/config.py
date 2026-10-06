"""Central pipeline configuration. Every tunable lives here so runs are reproducible."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
RAW_PARQUET = DATA_DIR / "raw" / "app_reviews.parquet"
CACHE_DIR = DATA_DIR / "cache"
REPORTS_DIR = ROOT / "reports"

RANDOM_SEED = 42
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
EMBEDDING_DIM = 384

# --- cleaning / sampling -------------------------------------------------
MIN_WORDS = 5
MIN_CHARS = 20
MAX_CHARS = 1500
SAMPLE_CAP_PER_APP = 600           # keeps one huge app (Google Play Services) from dominating

# --- sentiment -----------------------------------------------------------
RATING_WEIGHT = 0.3                # weak rating signal blended with VADER
NEG_THRESHOLD = -0.2
POS_THRESHOLD = 0.2

# --- clustering (final choice is justified in reports/clustering_evaluation.json) ----
CLUSTER_METHOD = "kmeans"
KMEANS_K = 80
HDBSCAN_MIN_CLUSTER_SIZE = 40
PCA_DIMS = 48
ASSIGN_MIN_SIMILARITY = 0.30       # new feedback below this cosine sim to every theme -> Uncategorized

# --- trends --------------------------------------------------------------
TREND_WINDOW_CANDIDATES_DAYS = (7, 14, 30, 60, 90)
TREND_MIN_WINDOW_RECORDS = 1500
TREND_BASELINE_WINDOWS = 6
TREND_MIN_RECENT_COUNT = 15
TREND_Z_FLAG = 2.0
TREND_MIN_SHARE_INCREASE = 0.25

# --- prioritization defaults --------------------------------------------
DEFAULT_WEIGHTS = {
    "frequency": 0.25,
    "severity": 0.20,
    "trend": 0.15,
    "customer_impact": 0.15,
    "sentiment": 0.10,
    "strategic_fit": 0.15,
}
DEFAULT_STRATEGIC_FIT = 5.0        # PM-defined 0-10; neutral until the PM sets it
