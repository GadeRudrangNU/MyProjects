"""Replays held-out tickets into the running instance and measures the live system.

Needs the instance (8070) and the agent (8000, started with TP_RETRIEVAL_EXCLUDE_SPLITS='["test"]').
Usage: python eval/replay.py [--n 200]
"""

import argparse
import json
import re
import sys
import time
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SN = "http://127.0.0.1:8070"
AUTH = ("desk.agent", "agent-local")
DONE = {"completed", "needs_review", "failed"}


def table(c, name, query="", limit=1000, fields=""):
    p = {"sysparm_limit": limit}
    if query:
        p["sysparm_query"] = query
    if fields:
        p["sysparm_fields"] = fields
    return c.get(f"/api/now/table/{name}", params=p).json()["result"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--timeout", type=int, default=3600)
    args = ap.parse_args()

    test = pd.read_csv(ROOT / "data" / "processed" / "test.csv").sample(args.n, random_state=21).reset_index(drop=True)
    c = httpx.Client(base_url=SN, auth=AUTH, timeout=60)
    admin = httpx.Client(base_url=SN, auth=("admin", "admin-local"), timeout=60)

    sent = {}
    runs = {}
    t0 = time.time()
    for i, r in test.iterrows():
        words = r["text"].split()
        body = {"short_description": " ".join(words[:10])[:80], "description": r["text"], "priority": "3"}
        res = c.post("/api/now/table/incident", json=body)
        res.raise_for_status()
        sys_id = res.json()["result"]["sys_id"]
        sent[sys_id] = {"truth": r["category"], "ticket_id": r["ticket_id"]}
        # one ticket at a time, so the measured latency is the agent's own and not time spent waiting in a queue
        end = time.time() + 240
        while time.time() < end:
            rows = table(admin, "x_tp_ai_triage_run", f"incident={sys_id}")
            if rows and rows[0]["status"] in DONE and rows[0]["outcome"] != "pending":
                runs[sys_id] = rows[0]
                break
            time.sleep(0.5)
        if (i + 1) % 10 == 0:
            print(f"  {i + 1}/{len(test)} done  ({time.time() - t0:.0f}s)", flush=True)

    # a person resolves each ticket with the true category (no close notes, so no article is drafted)
    for sys_id, info in sent.items():
        c.patch(f"/api/now/table/incident/{sys_id}", json={"category": info["truth"], "state": "6"}).raise_for_status()

    kb_numbers = {a["number"] for a in table(admin, "kb_knowledge", limit=2000)}
    rows = []
    for sys_id, info in sent.items():
        r = runs.get(sys_id)
        if not r:
            rows.append({**info, "status": "missing"})
            continue
        cited = [x for x in r["cited_articles"].split(",") if x]
        in_text = re.findall(r"\bKB\d{4,}\b", r["reply_draft"])
        retrieved = {x for x in r["retrieved_articles"].split(",") if x}
        rows.append(
            {
                **info,
                "status": r["status"],
                "outcome": r["outcome"],
                "suggested": r["suggested_category"],
                "confidence": float(r["confidence"] or 0),
                "path": r["path"],
                "latency_ms": int(r["latency_ms"] or 0),
                "attempts": int(r["attempts"] or 1),
                "grounding_violation": r["status"] == "completed" and any(x not in kb_numbers or x not in retrieved for x in cited + in_text),
            }
        )
    df = pd.DataFrame(rows)
    answered = df[df["status"].isin(["completed", "needs_review"])]
    auto = df[df["outcome"] == "auto_routed"]
    result = {
        "tickets": len(df),
        "answered": int(len(answered)),
        "failed_runs": int((df["status"] == "failed").sum()),
        "needs_review": int((df["status"] == "needs_review").sum()),
        "auto_routed": int(len(auto)),
        "auto_routed_pct": round(len(auto) / max(len(answered), 1) * 100, 1),
        "routing_accuracy_pct": round((auto["suggested"] == auto["truth"]).mean() * 100, 1) if len(auto) else None,
        "suggestion_accuracy_pct": round((answered["suggested"] == answered["truth"]).mean() * 100, 1) if len(answered) else None,
        "fast_path_pct": round((answered["path"] == "fast").mean() * 100, 1) if len(answered) else None,
        "approvals_requested": int((df["outcome"] == "approval_requested").sum()),
        "grounding_violations": int(df["grounding_violation"].sum()) if "grounding_violation" in df else 0,
        "validator_interventions": int((df["attempts"] > 1).sum()) if "attempts" in df else 0,
        "latency_ms_p50": int(answered["latency_ms"].quantile(0.5)) if len(answered) else None,
        "latency_ms_p95": int(answered["latency_ms"].quantile(0.95)) if len(answered) else None,
        "wall_clock_s": int(time.time() - t0),
        "dashboard_metrics": admin.get("/api/x_tp/triage/metrics").json()["result"],
    }
    out = ROOT / "eval"
    (out / "replay_results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    df.drop(columns=["ticket_id"]).to_csv(out / "replay_predictions.csv", index=False)
    print(json.dumps({k: v for k, v in result.items() if k != "dashboard_metrics"}, indent=2))


if __name__ == "__main__":
    main()
