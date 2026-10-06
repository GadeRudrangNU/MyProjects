import pandas as pd

from ml import preprocessing as pp


def test_clean_text_strips_urls_emails_and_squeezes_repeats():
    raw = "Sooooooo bad!!!!  see https://x.io/a?b=1 or mail me@ex.com   thanks"
    out = pp.clean_text(raw)
    assert "http" not in out and "@" not in out
    assert "ooooo" not in out and "sooo" in out.lower()
    assert "  " not in out


def test_clean_text_handles_none():
    assert pp.clean_text(None) == ""


def test_informative_and_english_filters():
    assert pp.is_informative("The app crashes when I upload a photo")
    assert not pp.is_informative("great app")                       # too short
    assert not pp.is_informative("!!! ??? ... --- ### $$$ %%% ^^^")  # not alphabetic
    assert pp.looks_english("The app crashes when I upload a photo")
    assert not pp.looks_english("Esta aplicación es muy buena y funciona perfectamente bien")
    assert not pp.looks_english("这个应用非常好用而且很稳定我很喜欢")


def test_clean_dataframe_reports_every_drop_and_consolidates_duplicates():
    df = pd.DataFrame({
        "text": [
            "The app crashes when I upload a photo",
            "the app crashes when I upload a photo!!",     # duplicate after normalization
            "ok",                                           # too short
            "",                                             # empty
            "Esta aplicación es muy buena y funciona perfectamente bien",  # non-English
            "Login keeps failing with my correct password every time",
        ],
        "created_at": ["2020-01-02", "2020-01-03", "2020-01-04", "2020-01-05", "2020-01-06", "bad-date"],
    })
    out, rep = pp.clean_dataframe(df)
    assert rep.raw_records == 6
    assert rep.unparseable_date == 1
    assert rep.empty_text == 1
    assert rep.exact_duplicates_consolidated == 1
    assert rep.non_english == 1
    assert len(out) == 1 and out.iloc[0]["duplicate_count"] == 1
    # accounting is exhaustive: nothing silently lost
    assert (rep.unparseable_date + rep.empty_text + rep.too_short_or_noisy + rep.non_english
            + rep.exact_duplicates_consolidated + len(out)) == rep.raw_records


def test_cap_per_group_is_deterministic_and_caps():
    df = pd.DataFrame({"product_area": ["a"] * 50 + ["b"] * 5, "created_at": pd.date_range("2020-01-01", periods=55), "text": range(55)})
    a, b = pp.cap_per_group(df, "product_area", 10, seed=1), pp.cap_per_group(df, "product_area", 10, seed=1)
    assert a.product_area.value_counts().to_dict() == {"a": 10, "b": 5}
    assert a.text.tolist() == b.text.tolist()


def test_feedback_id_is_stable():
    assert pp.feedback_id("s", "a", "2020-01-01", "x") == pp.feedback_id("s", "a", "2020-01-01", "x")
    assert pp.feedback_id("s", "a", "2020-01-01", "x") != pp.feedback_id("s", "a", "2020-01-02", "x")
