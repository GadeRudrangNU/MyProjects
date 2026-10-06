import pytest

from wroomcheck.backtest import BacktestConfig
from wroomcheck.detect import DetectConfig
from wroomcheck.embeddings import HashingEmbedder
from wroomcheck.pipeline import analyze, embed_all, sort_key
from wroomcheck.synth import generate


@pytest.fixture(scope="session")
def world():
    complaints, campaigns = generate(seed=7)
    complaints.sort(key=sort_key)
    return complaints, campaigns


@pytest.fixture(scope="session")
def analysis(world):
    complaints, campaigns = world
    emb = HashingEmbedder()
    vecs = embed_all(complaints, emb)
    cfg = DetectConfig(threshold=emb.default_threshold)
    return analyze(zip(complaints, vecs), campaigns, cfg, BacktestConfig())
