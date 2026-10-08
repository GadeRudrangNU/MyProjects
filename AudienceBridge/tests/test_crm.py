import pandas as pd

from audiencebridge import crm, privacy


def users(n=3000):
    return pd.DataFrame({"user_pseudo_id": [f"u{i}" for i in range(n)], "purchases": [1 if i % 10 == 0 else 0 for i in range(n)]})


CFG = {"seed": 7, "purchaser_match_rate": 0.9, "other_match_rate": 0.3}


def test_generation_is_deterministic():
    pd.testing.assert_frame_equal(crm.build_crm(users(), CFG), crm.build_crm(users(), CFG))


def test_purchasers_match_more_often():
    frame = crm.build_crm(users(), CFG)
    purchasers = {f"u{i}" for i in range(0, 3000, 10)}
    rate_p = frame["user_pseudo_id"].isin(purchasers).sum() / len(purchasers)
    rate_o = (~frame["user_pseudo_id"].isin(purchasers)).sum() / (3000 - len(purchasers))
    assert rate_p > 0.8 and 0.2 < rate_o < 0.4


def test_data_is_deliberately_messy_but_mostly_usable():
    frame = crm.build_crm(users(), CFG)
    emails = frame["email"].dropna()
    assert emails.str.contains("[A-Z]").any()
    assert emails.str.startswith(" ").any()
    normalised = emails.map(privacy.normalize_email)
    assert normalised.isna().any()
    assert normalised.notna().mean() > 0.9
    assert frame["phone"].map(privacy.normalize_phone).notna().mean() > 0.8
    assert set(frame.columns) == set(crm.CRM_COLUMNS)


def test_consent_flags_vary():
    frame = crm.build_crm(users(), CFG)
    assert 0.7 < frame["consent_ad_user_data"].mean() < 0.98
    assert (~frame["consent_ad_personalization"]).any()
