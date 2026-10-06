import zipfile

from wroomcheck.nhtsa import clean_text, comp_category, iter_complaints, load_campaigns, parse_date
from wroomcheck.synth import write_flat_files


def test_comp_category_normalises_both_datasets():
    assert comp_category("SERVICE BRAKES, HYDRAULIC:FOUNDATION COMPONENTS") == "SERVICE BRAKES"
    assert comp_category("air bags:frontal:driver side") == "AIR BAGS"
    assert comp_category("STEERING") == "STEERING"


def test_clean_text_strips_reviewer_initials_and_whitespace():
    assert clean_text("THE  CAR STALLED. *TR\n  NEXT LINE") == "THE CAR STALLED. NEXT LINE"


def test_parse_date():
    assert parse_date("20200229").isoformat() == "2020-02-29"
    assert parse_date("") is None and parse_date("20201340") is None


def test_flat_file_round_trip(world, tmp_path):
    complaints, campaigns = world
    cpath, rpath = write_flat_files(tmp_path, complaints[:300], campaigns)
    parsed = list(iter_complaints(cpath))
    assert len(parsed) == 300
    first = parsed[0]
    assert (first.id, first.make, first.date_received) == (complaints[0].id, complaints[0].make, complaints[0].date_received)
    assert first.comp_cat == complaints[0].comp_cat
    camps = load_campaigns(rpath)
    assert len(camps) == len(campaigns)
    assert {c.camp_no for c in camps} == {c.camp_no for c in campaigns}


def test_zip_input_and_filters(world, tmp_path):
    complaints, campaigns = world
    cpath, _ = write_flat_files(tmp_path, complaints[:300], campaigns)
    zpath = tmp_path / "FLAT_CMPL.zip"
    with zipfile.ZipFile(zpath, "w") as zf:
        zf.write(cpath, "FLAT_CMPL.txt")
    makes = {c.make for c in complaints[:300]}
    one = sorted(makes)[0]
    only = list(iter_complaints(zpath, makes=[one]))
    assert only and all(c.make == one for c in only)
    assert len(list(iter_complaints(zpath, limit=10))) == 10
    assert not list(iter_complaints(zpath, year_from=2030))
