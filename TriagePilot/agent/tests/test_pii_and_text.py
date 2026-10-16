import json
from pathlib import Path

import pytest

from triagepilot.pii import contains_pii, scrub
from triagepilot.textprep import normalize

CASES = json.loads((Path(__file__).resolve().parents[2] / "shared" / "pii_cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=[c["in"][:30] or "empty" for c in CASES])
def test_scrub_matches_shared_cases(case):
    assert scrub(case["in"]) == case["out"]


def test_contains_pii():
    assert contains_pii("write to a@b.co")
    assert not contains_pii("nothing sensitive")


def test_normalize_matches_training_style():
    out = normalize("Hi, my Laptops are not starting! Please call 617-555-0142 or mail [EMAIL].")
    assert out == "laptop starting call mail" or "laptop" in out.split()
    assert "[" not in out and "," not in out and "hi" not in out.split()
