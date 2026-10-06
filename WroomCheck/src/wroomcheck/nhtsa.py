"""Download and parse NHTSA bulk flat files (complaints and recalls).

Source pages: https://www.nhtsa.gov/nhtsa-datasets-and-apis
Flat files are tab-delimited, header-less, latin-1 text, optionally zipped. Only the leading
columns are used, so later additions to the layout do not break parsing.
"""
from __future__ import annotations

import csv
import io
import re
import sys
import urllib.request
import zipfile
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Iterable, Iterator

from .models import Campaign, Complaint

_BASE = "https://static.nhtsa.gov/odi/ffdd"
# Complaints are published in 5-year bundles (same layout as FLAT_CMPL.zip) plus the full file.
COMPLAINT_BUNDLES = {
    "2015-2019": f"{_BASE}/cmpl/COMPLAINTS_RECEIVED_2015-2019.zip",
    "2020-2024": f"{_BASE}/cmpl/COMPLAINTS_RECEIVED_2020-2024.zip",
}
RECALLS_URL = f"{_BASE}/rcl/FLAT_RCL_POST_2010.zip"  # recalls from 2010 on

# column indexes (0-based) in FLAT_CMPL.txt
C_ID, C_MAKE, C_MODEL, C_YEAR, C_CRASH, C_FAILDATE, C_FIRE, C_INJ, C_DEATHS = 1, 3, 4, 5, 6, 7, 8, 9, 10  # C_ID = ODINO
C_COMP, C_DATEA, C_CDESCR = 11, 15, 19
# column indexes in FLAT_RCL.txt
R_CAMPNO, R_MAKE, R_MODEL, R_YEAR, R_COMP, R_RCLTYPE, R_POTAFF = 1, 2, 3, 4, 6, 10, 11
R_RCDATE, R_DESC, R_CONSEQ, R_REMEDY = 15, 19, 20, 21

csv.field_size_limit(min(sys.maxsize, 2**31 - 1))
_INITIALS = re.compile(r"\*[A-Z]{2,3}\b")  # NHTSA appends reviewer initials like "*TR"
_SPACES = re.compile(r"\s+")
# Owners writing about a recall repair ("received notification of NHTSA Campaign Number 22V142000...")
# are reacting to a recall, not warning of one, so they would leak the answer into the backtest.
CAMPAIGN_REF = re.compile(r"\b\d{2}[VEIT]\d{3}(?:\d{3})?\b", re.IGNORECASE)


def comp_category(component: str) -> str:
    """'SERVICE BRAKES, HYDRAULIC:ABS' -> 'SERVICE BRAKES' (same rule for complaints and recalls)."""
    return re.split(r"[:,]", component.strip().upper(), maxsplit=1)[0].strip()


def clean_text(text: str) -> str:
    return _SPACES.sub(" ", _INITIALS.sub("", text)).strip()


def parse_date(value: str) -> date | None:
    value = value.strip()
    if len(value) != 8 or not value.isdigit():
        return None
    try:
        return datetime.strptime(value, "%Y%m%d").date()
    except ValueError:
        return None


def download(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        print(f"{dest} already exists, skipping download")
        return dest
    print(f"Downloading {url} -> {dest}")
    with urllib.request.urlopen(url) as resp, open(dest, "wb") as out:  # noqa: S310 (fixed https URL)
        while chunk := resp.read(1 << 20):
            out.write(chunk)
    return dest


def _open_lines(path: Path) -> Iterator[list[str]]:
    """Yield tab-split rows from a .txt or a .zip containing one .txt."""
    if path.suffix.lower() == ".zip":
        zf = zipfile.ZipFile(path)
        name = next(n for n in zf.namelist() if n.lower().endswith(".txt"))
        raw = zf.open(name)
    else:
        raw = open(path, "rb")
    with io.TextIOWrapper(raw, encoding="latin-1", newline="") as fh:
        yield from csv.reader(fh, delimiter="\t", quoting=csv.QUOTE_NONE)


def iter_complaints(paths: Path | Iterable[Path], *args, **kwargs) -> Iterator[Complaint]:
    """Stream complaints from one or several files (see `_iter_one` for the filters).

    NHTSA repeats a complaint (same ODINO and narrative) once per affected component, so we keep
    only the first row per ODINO, i.e. each complaint is filed under its first-listed component.
    """
    seen: set[int] = set()
    for path in [paths] if isinstance(paths, Path) else paths:
        for c in _iter_one(path, *args, **kwargs):
            if c.id not in seen:
                seen.add(c.id)
                yield c


def _iter_one(
    path: Path,
    year_from: int | None = None,
    year_to: int | None = None,
    makes: Iterable[str] | None = None,
    limit: int | None = None,
    min_chars: int = 40,
) -> Iterator[Complaint]:
    """Stream complaints, filtering by *receipt* year (DATEA) and optional make list."""
    wanted = {m.upper() for m in makes} if makes else None
    n = 0
    for row in _open_lines(path):
        if len(row) <= C_CDESCR:
            continue
        received = parse_date(row[C_DATEA])
        if received is None:
            continue
        if (year_from and received.year < year_from) or (year_to and received.year > year_to):
            continue
        make = row[C_MAKE].strip().upper()
        if wanted and make not in wanted:
            continue
        try:
            year = int(row[C_YEAR])
            cid = int(row[C_ID])
        except ValueError:
            continue
        text = clean_text(row[C_CDESCR])
        if year < 1950 or year > 2100 or len(text) < min_chars or CAMPAIGN_REF.search(text):
            continue
        component = row[C_COMP].strip().upper()
        yield Complaint(
            id=cid,
            make=make,
            model=row[C_MODEL].strip().upper(),
            year=year,
            component=component,
            comp_cat=comp_category(component),
            date_received=received,
            fail_date=parse_date(row[C_FAILDATE]),
            text=text,
            crash=row[C_CRASH].strip().upper() == "Y",
            fire=row[C_FIRE].strip().upper() == "Y",
            injured=_to_int(row[C_INJ]),
            deaths=_to_int(row[C_DEATHS]),
        )
        n += 1
        if limit and n >= limit:
            return


def _to_int(value: str) -> int:
    try:
        return int(value)
    except ValueError:
        return 0


def load_campaigns(
    path: Path,
    makes: Iterable[str] | None = None,
    date_from: date | None = None,
) -> list[Campaign]:
    """Aggregate FLAT_RCL rows (one per model/year/component) into one Campaign per make+model."""
    wanted = {m.upper() for m in makes} if makes else None
    groups: dict[tuple[str, str, str], dict] = {}
    years: dict[tuple[str, str, str], set[int]] = defaultdict(set)
    cats: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    for row in _open_lines(path):
        if len(row) <= R_REMEDY or row[R_RCLTYPE].strip().upper() != "V":
            continue  # vehicle recalls only (skip equipment, tires, child seats)
        rcdate = parse_date(row[R_RCDATE])
        make = row[R_MAKE].strip().upper()
        if rcdate is None or (wanted and make not in wanted) or (date_from and rcdate < date_from):
            continue
        key = (row[R_CAMPNO].strip(), make, row[R_MODEL].strip().upper())
        try:
            y = int(row[R_YEAR])
        except ValueError:
            y = 9999
        if y != 9999:
            years[key].add(y)
        cat = comp_category(row[R_COMP])
        if cat:
            cats[key].add(cat)
        groups.setdefault(
            key,
            dict(
                report_date=rcdate,
                component=row[R_COMP].strip(),
                description=clean_text(row[R_DESC]),
                consequence=clean_text(row[R_CONSEQ]),
                remedy=clean_text(row[R_REMEDY]),
                potentially_affected=_to_int(row[R_POTAFF]),
            ),
        )
    return [
        Campaign(camp_no=k[0], make=k[1], model=k[2], years=tuple(sorted(years[k])),
                 comp_cats=tuple(sorted(cats[k])), **g)
        for k, g in groups.items()
        if years[k]
    ]
