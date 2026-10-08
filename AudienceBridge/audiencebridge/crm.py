from __future__ import annotations

import random

import pandas as pd

from . import bq
from .config import ClientConfig, Settings

DOMAINS = [
    ("gmail.com", 0.45),
    ("yahoo.com", 0.15),
    ("outlook.com", 0.15),
    ("icloud.com", 0.10),
    ("hotmail.com", 0.08),
    ("example.org", 0.07),
]
LOYALTY_TIERS = [("none", 0.55), ("silver", 0.25), ("gold", 0.15), ("platinum", 0.05)]

CRM_COLUMNS = [
    "user_pseudo_id",
    "email",
    "phone",
    "first_name",
    "last_name",
    "postal_code",
    "country_code",
    "loyalty_tier",
    "consent_ad_user_data",
    "consent_ad_personalization",
]


def _weighted(rng: random.Random, options: list[tuple[str, float]]) -> str:
    return rng.choices([o[0] for o in options], weights=[o[1] for o in options], k=1)[0]


def _phone(rng: random.Random) -> str:
    area, exch, line = rng.randint(201, 989), rng.randint(200, 999), rng.randint(0, 9999)
    a, e, ln = f"{area}", f"{exch}", f"{line:04d}"
    style = rng.choice(["e164", "paren", "dash", "dot", "one-dash", "digits"])
    return {
        "e164": f"+1{a}{e}{ln}",
        "paren": f"({a}) {e}-{ln}",
        "dash": f"{a}-{e}-{ln}",
        "dot": f"{a}.{e}.{ln}",
        "one-dash": f"1-{a}-{e}-{ln}",
        "digits": f"{a}{e}{ln}",
    }[style]


def _email(rng: random.Random, first: str, last: str, index: int) -> str:
    domain = _weighted(rng, DOMAINS)
    local = f"{first}.{last}{index}".lower().replace("'", "").replace(" ", "")
    if domain == "gmail.com" and rng.random() < 0.25:
        local = local.replace(".", "")
        pos = rng.randint(1, max(1, len(local) - 1))
        local = local[:pos] + "." + local[pos:]
    return f"{local}@{domain}"


def _mess_up(rng: random.Random, email: str, phone: str) -> tuple[str | None, str | None]:
    if rng.random() < 0.10:
        email = email.upper()
    if rng.random() < 0.05:
        email = f"  {email} "
    roll = rng.random()
    if roll < 0.02:
        email = email.replace("@", "", 1)
    elif roll < 0.03:
        email = email.split("@")[0] + "@localhost"
    roll = rng.random()
    if roll < 0.04:
        phone = rng.choice(["12345", "555-12", "n/a", "000"])
    elif roll < 0.08:
        phone = None
    if rng.random() < 0.03:
        email = None
    return email, phone


def build_crm(users: pd.DataFrame, crm_cfg: dict, seed: int | None = None) -> pd.DataFrame:
    from faker import Faker

    seed = crm_cfg.get("seed", 42) if seed is None else seed
    purchaser_rate = float(crm_cfg.get("purchaser_match_rate", 0.90))
    other_rate = float(crm_cfg.get("other_match_rate", 0.30))
    p_user_data = float(crm_cfg.get("consent_ad_user_data_rate", 0.88))
    p_personalization = float(crm_cfg.get("consent_ad_personalization_rate", 0.85))

    rng = random.Random(seed)
    fake = Faker("en_US")
    Faker.seed(seed)

    rows = []
    for index, user in enumerate(users.sort_values("user_pseudo_id").itertuples(index=False)):
        rate = purchaser_rate if user.purchases > 0 else other_rate
        if rng.random() >= rate:
            continue
        first, last = fake.first_name(), fake.last_name()
        email, phone = _mess_up(rng, _email(rng, first, last, index), _phone(rng))
        rows.append(
            {
                "user_pseudo_id": user.user_pseudo_id,
                "email": email,
                "phone": phone,
                "first_name": f" {first} " if rng.random() < 0.05 else first,
                "last_name": last.upper() if rng.random() < 0.05 else last,
                "postal_code": fake.zipcode(),
                "country_code": "US",
                "loyalty_tier": _weighted(rng, LOYALTY_TIERS),
                "consent_ad_user_data": rng.random() < p_user_data,
                "consent_ad_personalization": rng.random() < p_personalization,
            }
        )
    return pd.DataFrame(rows, columns=CRM_COLUMNS)


def generate_and_load(client, settings: Settings, cfg: ClientConfig) -> int:
    users = bq.query_df(
        client,
        f"SELECT user_pseudo_id, purchases FROM `{bq.table_id(settings, 'marts', 'user_features')}`",
    )
    crm = build_crm(users, cfg.crm)
    from google.cloud import bigquery

    schema = [bigquery.SchemaField(name, "BOOL" if name.startswith("consent_") else "STRING") for name in CRM_COLUMNS]
    bq.load_df(client, crm, bq.table_id(settings, "raw", "crm_customers"), schema=schema)
    return len(crm)
