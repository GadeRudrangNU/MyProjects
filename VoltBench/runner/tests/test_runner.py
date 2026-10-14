import math
from pathlib import Path

import pytest

from runner import expr
from runner.dsl import parse_yaml
from runner.executor import crossing_time, percentile, signal_stats

LIBRARY = Path(__file__).resolve().parent.parent / "library"


@pytest.mark.parametrize("path", sorted(p for p in LIBRARY.glob("*.yaml") if not p.name.startswith("plan_")))
def test_library_definitions_are_valid(path):
    spec, errors = parse_yaml(path.read_text())
    assert errors == [] and spec is not None


def test_expression_evaluation():
    assert expr.evaluate("value >= 0.9 * 5.0", {"value": 4.6})
    assert not expr.evaluate("a < 1 and b < 1", {"a": 0, "b": 2})
    assert expr.evaluate("version == expected", {"version": "2.4.1", "expected": "2.4.1"})
    assert expr.evaluate("1 < x <= 3", {"x": 3})
    assert expr.evaluate("abs(x - 5) < 1", {"x": 4.5})


@pytest.mark.parametrize("bad", ["__import__('os').system('x')", "x.__class__", "[1, 2][0]", "lambda: 1", "open('f')"])
def test_expression_rejects_unsafe_syntax(bad):
    with pytest.raises(expr.ExprError):
        expr.evaluate(bad, {"x": 1})


def test_unknown_name_is_an_error():
    with pytest.raises(expr.ExprError):
        expr.evaluate("nope > 1", {})


def test_percentile_nearest_rank():
    data = list(range(1, 21))
    assert percentile(data, 95) == 19
    assert percentile(data, 100) == 20
    assert percentile([7], 50) == 7
    assert percentile([5, 1, 3], 50) == 3


def test_signal_stats():
    sig = {"hard": [0, 10], "nominal": 5, "sigma": 1, "range": [2, 8]}
    stats = signal_stats([4, 5, 6, 11], sig)
    assert stats["out_of_limits"] == 1 and stats["count"] == 4 and stats["max"] == 11


def test_crossing_time_interpolates_between_samples():
    pts = [(0, 0.0), (100, 3.0), (200, 5.0)]
    t = crossing_time(pts, "value >= 4.0", {})
    assert t == pytest.approx(150, abs=0.5)
    assert crossing_time(pts, "value >= 9", {}) is None


GOOD = """name: sample_test
kind: custom
device_type: BCM
version: 2
steps:
  - command: GET_VERSION
    record_version_as: version
  - assert: "version == expected_firmware"
"""


def test_valid_yaml_parses():
    spec, errors = parse_yaml(GOOD)
    assert errors == [] and spec.version == 2


def test_error_points_at_the_offending_line():
    bad = GOOD.replace("version == expected_firmware", "version ==")
    _, errors = parse_yaml(bad)
    assert errors and errors[0]["line"] == 8


def test_unknown_field_and_missing_field_are_located():
    bad = GOOD.replace("kind: custom", "knd: custom")
    _, errors = parse_yaml(bad)
    messages = " ".join(e["message"] for e in errors)
    assert "kind" in messages and any(e["line"] == 2 for e in errors)


def test_undefined_names_are_rejected():
    bad = GOOD.replace('"version == expected_firmware"', '"mystery > 1"')
    _, errors = parse_yaml(bad)
    assert any("mystery" in e["message"] for e in errors)


def test_yaml_syntax_error_has_line():
    _, errors = parse_yaml("name: [unclosed\nkind: x")
    assert errors and errors[0]["line"] >= 1


def test_infinite_values_are_not_stored():
    from runner.executor import clean

    assert clean({"a": math.inf, "b": [1, math.nan]}) == {"a": None, "b": [1, None]}
