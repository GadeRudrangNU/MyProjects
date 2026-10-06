"""Delete all locally stored data"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

ap = argparse.ArgumentParser()
ap.add_argument("--yes", action="store_true", help="confirm deletion")
ap.add_argument("--db")
args = ap.parse_args()
if not args.yes:
    sys.exit("Refusing to delete without --yes")
if args.db:
    os.environ["DATABASE_URL"] = f"sqlite:///{Path(args.db).resolve().as_posix()}"

from backend.app.db import get_session, init_db  # noqa: E402
from backend.app.services import store  # noqa: E402

init_db()
print(store.delete_all_user_data(get_session()))
