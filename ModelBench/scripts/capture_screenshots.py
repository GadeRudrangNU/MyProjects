"""Drive the real UI end to end and save README screenshots to docs/screenshots/.

Needs the API (:8000) and the frontend dev server running, plus:  pip install playwright
Uses your installed Edge/Chrome, so no browser download:  --channel msedge | chrome
"""
import argparse
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent.parent / "docs" / "screenshots"
MODELS = ["distilbert-sst2", "distilbert-imdb", "keyword-baseline"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:5173")
    ap.add_argument("--channel", default="msedge")
    ap.add_argument("--scheme", default="light", choices=["light", "dark"])
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(channel=args.channel)
        page = browser.new_page(viewport={"width": 1280, "height": 820}, color_scheme=args.scheme)
        page.goto(args.url)
        page.get_by_role("button", name="Launch run").wait_for()

        for name in MODELS:  # launch through the UI, exactly as a user would
            page.get_by_label("Model").select_option(label=name)
            page.get_by_role("button", name="Launch run").click()
            page.wait_for_timeout(300)
        page.screenshot(path=OUT / "01-runs-in-progress.png")

        page.wait_for_function("document.querySelectorAll('.badge.completed').length >= 3", timeout=240_000)
        for box in page.locator("input[type=checkbox]").all():
            box.check()
        page.screenshot(path=OUT / "02-runs-completed.png")

        page.get_by_role("tab", name="Compare (3)").click()
        page.wait_for_timeout(1500)  # let chart animations finish
        page.screenshot(path=OUT / "03-compare.png", full_page=True)

        page.get_by_role("tab", name="Models").click()
        page.screenshot(path=OUT / "04-models.png")

        page.get_by_role("tab", name="Playground").click()
        page.get_by_label("Model").select_option(label="distilbert-sst2")
        page.get_by_placeholder("Type a sentence").fill("I did not expect to enjoy it this much, what a wonderful surprise.")
        page.get_by_role("button", name="Classify").click()
        page.get_by_test_id("prediction").wait_for()
        page.get_by_role("button", name="Classify").click()  # second call = warm latency
        page.wait_for_timeout(800)
        page.screenshot(path=OUT / "05-playground.png")
        browser.close()
    print("saved", *sorted(f.name for f in OUT.glob("*.png")))


if __name__ == "__main__":
    main()
