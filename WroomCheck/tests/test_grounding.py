from wroomcheck.grounding import check_summary

EVIDENCE = {
    101: "THE ENGINE STALLED AT 65 MPH ON THE HIGHWAY.",
    102: "BRAKE FLUID LEAKED FROM THE REAR CALIPER.",
}
FACTS = "complaints in the 90 days before the alert: 12; model years: 2021"


def test_fully_cited_summary_passes():
    text = "Twelve owners reported stalling [C101]. One said it stalled at 65 mph [C101]."
    assert check_summary(text, EVIDENCE, FACTS).ok


def test_missing_citation_is_flagged():
    rep = check_summary("Owners report stalling.", EVIDENCE, FACTS)
    assert not rep.ok and "no citation" in rep.issues


def test_unknown_citation_is_flagged():
    rep = check_summary("Owners report stalling [C999].", EVIDENCE, FACTS)
    assert not rep.ok and "unknown citation" in rep.issues[0]


def test_invented_number_is_flagged():
    rep = check_summary("Owners reported 47 incidents [C101].", EVIDENCE, FACTS)
    assert not rep.ok and "unsupported number" in rep.issues[0]


def test_numbers_from_facts_are_allowed():
    assert check_summary("12 complaints arrived in 90 days [C102].", EVIDENCE, FACTS).ok


def test_empty_summary_fails():
    assert not check_summary("", EVIDENCE, FACTS).ok
