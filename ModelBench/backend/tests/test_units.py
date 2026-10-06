import sys
import types

import pytest

from app import datasets, evaluator, predictors
from app.metrics import classification_metrics, percentile


def test_percentile_interpolates():
    assert percentile([10, 20, 30, 40], 50) == 25
    assert percentile([5], 95) == 5
    assert percentile([], 95) == 0.0
    assert percentile(list(range(1, 101)), 95) == pytest.approx(95.05)


def test_classification_metrics_known_values():
    m = classification_metrics(["a", "a", "b", "b"], ["a", "b", "b", "b"])
    assert m["accuracy"] == 0.75
    assert m["per_class"]["a"] == {"precision": 1.0, "recall": 0.5, "f1": pytest.approx(2 / 3)}
    assert m["confusion_matrix"] == {"labels": ["a", "b"], "matrix": [[1, 1], [0, 2]]}
    assert classification_metrics([], [])["accuracy"] == 0.0


def test_keyword_predictor():
    out = predictors.KeywordPredictor().predict(["I love this, it is great!", "Terrible and boring."])
    assert [o["label"] for o in out] == ["positive", "negative"]


def test_get_predictor_is_cached():
    assert predictors.get_predictor("keyword:x") is predictors.get_predictor("keyword:x")


def test_hf_predictor_maps_labels(monkeypatch):
    fake = types.SimpleNamespace(
        pipeline=lambda *a, **k: lambda texts, **kw: [{"label": "LABEL_1", "score": 0.9}, {"label": "WEIRD", "score": 0.6}]
    )
    monkeypatch.setitem(sys.modules, "transformers", fake)
    out = predictors.HFPredictor("any/model", {}).predict(["x", "y"])
    assert out == [{"label": "positive", "score": 0.9}, {"label": "weird", "score": 0.6}]


def test_parse_csv_validation():
    assert datasets.parse_csv("text,label\nhi,Positive\n")[0] == {"text": "hi", "label": "positive"}
    with pytest.raises(ValueError):
        datasets.parse_csv("foo,bar\n1,2\n")
    with pytest.raises(ValueError):
        datasets.parse_csv("text,label\n")


def test_sample_dataset_is_balanced():
    rows = datasets.load_dataset(datasets.SAMPLE)
    labels = [r["label"] for r in rows]
    assert len(rows) >= 50 and set(labels) == {"positive", "negative"}


def test_unknown_dataset_and_bad_upload_name(tmp_path, monkeypatch):
    monkeypatch.setattr(datasets, "UPLOAD_DIR", tmp_path)
    with pytest.raises(FileNotFoundError):
        datasets.load_dataset("nope")
    with pytest.raises(ValueError):
        datasets.save_upload("sample_sentiment.csv", "text,label\na,positive\n")


def test_evaluate_reports_latency_and_metrics():
    model = types.SimpleNamespace(hf_id="keyword:baseline", label_map={})
    rows = [{"text": "great film", "label": "positive"}, {"text": "awful film", "label": "negative"}]
    result = evaluator.evaluate(model, rows)
    assert result["accuracy"] == 1.0
    assert result["latency_ms"]["p95"] >= result["latency_ms"]["p50"] >= 0
    assert result["throughput_per_s"] > 0
