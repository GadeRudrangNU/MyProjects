from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parents[1] / "screenshots"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5173")
    args = ap.parse_args()
    OUT.mkdir(exist_ok=True)
    top = json.load(urllib.request.urlopen(f"{args.base}/api/orders?tier=High&limit=1"))["items"][0]["line_id"]
    pages = [
        ("01-dashboard", "/", None),
        ("02-risk-explorer", "/risk", "table tbody tr"),
        ("03-prediction-explanation", f"/orders/{top}", "text=Factors increasing risk"),
        ("04-product-intelligence", "/products", "svg.recharts-surface"),
        ("05-intervention-simulator", "/simulator", "text=Net benefit"),
        ("06-experiment-design", "/experiment", "text=Per arm"),
        ("07-limitations", "/limitations", None),
    ]
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1440, "height": 900})
        for name, path, wait in pages:
            pg.goto(args.base + path)
            pg.wait_for_load_state("networkidle")
            if wait:
                pg.wait_for_selector(wait, timeout=15000)
            pg.wait_for_timeout(1200)
            pg.screenshot(path=str(OUT / f"{name}.png"), full_page=True)
            print("saved", name)
        b.close()


if __name__ == "__main__":
    main()

