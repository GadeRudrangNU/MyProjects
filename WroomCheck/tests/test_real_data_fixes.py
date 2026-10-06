"""Regression tests for problems found when running on real NHTSA data."""
from pathlib import Path

from wroomcheck.embeddings import prepare_text
from wroomcheck.nhtsa import iter_complaints


def row(odino: int, cmplid: int, comp: str, text: str) -> str:
    cols = [""] * 49
    cols[0], cols[1], cols[3], cols[4], cols[5] = str(cmplid), str(odino), "FORD", "FUSION", "2016"
    cols[11], cols[15], cols[19] = comp, "20210315", text
    return "\t".join(cols)


LONG = "THE BRAKE PEDAL WENT TO THE FLOOR WHILE DRIVING ON THE HIGHWAY AND THE CAR DID NOT STOP"


def test_one_row_per_complaint_even_when_listed_under_several_components(tmp_path: Path):
    f = tmp_path / "FLAT_CMPL.txt"
    f.write_text("\n".join([row(1, 10, "SERVICE BRAKES", LONG), row(1, 11, "ENGINE", LONG), row(2, 12, "ENGINE", LONG)]),
                 encoding="latin-1")
    got = list(iter_complaints(f))
    assert [c.id for c in got] == [1, 2]
    assert got[0].comp_cat == "SERVICE BRAKES"  # first-listed component wins


def test_complaints_citing_a_recall_campaign_are_dropped(tmp_path: Path):
    f = tmp_path / "FLAT_CMPL.txt"
    cited = LONG + " AND I RECEIVED NOTIFICATION OF NHTSA CAMPAIGN NUMBER 22V142000 BUT PARTS ARE UNAVAILABLE"
    f.write_text("\n".join([row(1, 10, "SERVICE BRAKES", cited), row(2, 11, "SERVICE BRAKES", LONG)]), encoding="latin-1")
    assert [c.id for c in iter_complaints(f)] == [2]


def test_prepare_text_strips_intake_boilerplate_but_keeps_the_defect():
    raw = "The contact owns a 2016 Ford Fusion. The contact stated that the brake pedal went to the floor."
    out = prepare_text(raw).lower()
    assert "contact" not in out and "ford fusion" not in out
    assert "brake pedal went to the floor" in out
