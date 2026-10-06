from __future__ import annotations

import sys
import urllib.request
import zipfile
from pathlib import Path

URL = "https://archive.ics.uci.edu/static/public/502/online+retail+ii.zip"
RAW = Path(__file__).resolve().parents[1] / "data" / "raw"
ZIP_PATH = RAW / "online_retail_ii.zip"
XLSX_PATH = RAW / "online_retail_II.xlsx"


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    if XLSX_PATH.exists():
        print(f"Already present: {XLSX_PATH}")
        return 0
    if not ZIP_PATH.exists():
        print(f"Downloading {URL} ...")
        urllib.request.urlretrieve(URL, ZIP_PATH)
    with zipfile.ZipFile(ZIP_PATH) as zf:
        zf.extractall(RAW)
    print(f"Extracted to {RAW}: {[p.name for p in RAW.iterdir()]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
