"""Capture README screenshots from the RUNNING app (real processed data, no mock-ups).

Usage:  python scripts/capture_screenshots.py [--base http://127.0.0.1:8765]
Requires the API (serving the built frontend, or Vite on :5173) to be running with data loaded.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent.parent / "screenshots"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8765")
    a = ap.parse_args()
    OUT.mkdir(exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1.5)

        def shot(path: str, name: str, wait: str, action=None, full=False):
            pg.goto(a.base + path, wait_until="networkidle")
            pg.wait_for_selector(wait, timeout=30000)
            if action:
                action()
            pg.wait_for_timeout(900)  # let Recharts animations settle
            pg.screenshot(path=str(OUT / name), full_page=full)
            print("saved", name)

        shot("/", "dashboard.png", "text=Feedback Command Center", full=True)
        shot("/themes", "themes.png", "text=Theme Explorer")
        shot("/emerging", "emerging.png", "text=Emerging Issues")

        def open_why():
            pg.get_by_role("button", name="Why this rank?").first.click()
        shot("/prioritization", "prioritization.png", "text=Prioritization Studio", open_why)
        shot("/roadmap", "roadmap.png", "text=Roadmap Candidates")
        shot("/feedback", "feedback.png", "text=Feedback")
        b.close()


if __name__ == "__main__":
    sys.exit(main())
