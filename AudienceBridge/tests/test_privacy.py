import hashlib

import pytest

from audiencebridge import privacy


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("  Test@Example.COM ", "test@example.com"),
        ("john.smith@gmail.com", "johnsmith@gmail.com"),
        ("J.o.h.n@GoogleMail.com", "john@googlemail.com"),
        ("john.smith@yahoo.com", "john.smith@yahoo.com"),
        ("no-at-sign.com", None),
        ("user@localhost", None),
        ("two@@example.com", None),
        ("", None),
        (None, None),
    ],
)
def test_normalize_email(raw, expected):
    assert privacy.normalize_email(raw) == expected


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("(617) 555-0123", "+16175550123"),
        ("617-555-0123", "+16175550123"),
        ("617.555.0123", "+16175550123"),
        ("1-617-555-0123", "+16175550123"),
        ("+16175550123", "+16175550123"),
        ("+44 20 7946 0958", "+442079460958"),
        ("6175550123", "+16175550123"),
        ("12345", None),
        ("n/a", None),
        (None, None),
    ],
)
def test_normalize_phone(raw, expected):
    assert privacy.normalize_phone(raw) == expected


def test_normalize_name():
    assert privacy.normalize_name("  ADA ") == "ada"
    assert privacy.normalize_name("   ") is None


def test_hash_matches_reference_sha256():
    expected = hashlib.sha256(b"test@example.com").hexdigest()
    assert privacy.hash_email(" TEST@example.com") == expected
    assert len(expected) == 64


def test_dotted_and_plain_gmail_hash_identically():
    assert privacy.hash_email("a.b.c@gmail.com") == privacy.hash_email("abc@gmail.com")


def test_invalid_input_hashes_to_none():
    assert privacy.hash_email("nope") is None
    assert privacy.hash_phone("123") is None


def test_sql_expressions_cover_all_templates():
    exprs = privacy.sql_expressions()
    assert set(exprs) == {"email_expr", "phone_expr", "name_expr_first", "name_expr_last"}
    assert "gmail|googlemail" in exprs["email_expr"]
    assert "{{" not in "".join(exprs.values())
