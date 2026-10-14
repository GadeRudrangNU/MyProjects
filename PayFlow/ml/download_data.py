"""Download the public ULB credit-card fraud dataset (284,807 transactions, 492 frauds).

The original is hosted on Kaggle, which needs a login. The identical CSV is mirrored by the
TensorFlow documentation at the URL below (no account needed, no cost).

    python ml/download_data.py
"""

import hashlib
import sys
import urllib.request
from pathlib import Path

URL = "https://storage.googleapis.com/download.tensorflow.org/data/creditcard.csv"
EXPECTED_BYTES = 150_828_752
TARGET = Path(__file__).resolve().parent / "data" / "creditcard.csv"


def main() -> int:
    if TARGET.exists() and TARGET.stat().st_size == EXPECTED_BYTES:
        print(f"already downloaded: {TARGET}")
        return 0
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    print(f"downloading {URL} (~144 MB)")
    digest = hashlib.sha256()
    with urllib.request.urlopen(URL, timeout=60) as response, TARGET.open("wb") as out:  # noqa: S310 - fixed https URL
        while chunk := response.read(1 << 20):
            out.write(chunk)
            digest.update(chunk)
    size = TARGET.stat().st_size
    if size != EXPECTED_BYTES:
        TARGET.unlink()
        print(f"unexpected size {size}, expected {EXPECTED_BYTES}", file=sys.stderr)
        return 1
    print(f"saved {TARGET} ({size:,} bytes, sha256 {digest.hexdigest()[:16]}...)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
