"""Capture screenshots of the running app with Playwright"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "screenshots"
BASE = os.environ.get("CC_UI", "http://127.0.0.1:5173")
API = os.environ.get("CC_API", "http://127.0.0.1:8000/api")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    if not requests.get(f"{API}/health", timeout=30).json().get("demo_data"):
        sys.exit("Refusing to run: backend is not in DEMO_DATA mode (would write into a real database).")
    jobs = requests.get(f"{API}/jobs?sort=best_match", timeout=60).json()
    for j, status in zip(jobs[:5], ["Saved", "Preparing", "Preparing", "Applied", "Saved"]):
        requests.post(f"{API}/jobs/{j['id']}/analyze", timeout=60)
        r = requests.post(f"{API}/applications", json={"job_id": j["id"], "status": status}, timeout=60)
        if status == "Saved":
            requests.patch(f"{API}/jobs/{j['id']}", json={"user_state": "saved"}, timeout=30)
    errors: list[str] = []
    top = jobs[0]["id"]
    shots = [("dashboard", "/", None), ("job-explorer", "/jobs", None), ("job-match", f"/jobs/{top}", "full"),
             ("resume-analysis", f"/resume-lab/{top}", "full"), ("application-workspace", f"/jobs/{top}/workspace", "full"),
             ("tracker", "/tracker", None), ("analytics", "/analytics", "full"), ("profile", "/profile", "full")]
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1440, "height": 900})
        pg.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        pg.on("response", lambda r: errors.append(f"HTTP {r.status} {r.url}") if r.status >= 400 and "/api/" in r.url else None)
        for name, path, full in shots:
            pg.goto(BASE + path, wait_until="networkidle", timeout=120000)
            if name == "resume-analysis":
                try:
                    pg.get_by_role("button", name="Generate suggestions").click(timeout=3000)
                    pg.wait_for_timeout(2500)
                except Exception:
                    pass
            pg.wait_for_timeout(1200)
            pg.screenshot(path=str(OUT / f"{name}.png"), full_page=bool(full))
            print("captured", name)
        b.close()
    print("\n".join(errors) if errors else "No console/network errors.")


if __name__ == "__main__":
    main()
