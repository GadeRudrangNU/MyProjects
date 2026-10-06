"""Orchestration shared by the offline demo and the Postgres pipeline."""
from __future__ import annotations

import json
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Callable, Iterable, Mapping

import numpy as np

from .backtest import BacktestConfig, Evaluation, evaluate, sweep
from .detect import ComplaintIndex, DetectConfig, build_alerts, cluster_stream
from .embeddings import Embedder, prepare_text
from .models import Campaign, Cluster, Complaint
from .summarize import Summarizer, keywords, summaries_for

LEAD_BINS = [(0, 4, "<4 wk"), (4, 8, "4-8 wk"), (8, 13, "8-13 wk"), (13, 26, "13-26 wk"), (26, 52, "26-52 wk"), (52, 10_000, "1 yr+")]


@dataclass
class Analysis:
    clusters: list[Cluster]
    evaluation: Evaluation
    sweep: list[dict]
    index: ComplaintIndex
    cfg: DetectConfig
    bt_cfg: BacktestConfig


def sort_key(c: Complaint) -> tuple:
    return (c.make, c.model, c.comp_cat, c.date_received, c.id)


def analyze(
    items: Iterable[tuple[Complaint, np.ndarray]],
    campaigns: list[Campaign],
    cfg: DetectConfig,
    bt_cfg: BacktestConfig | None = None,
    embedder: Embedder | None = None,
) -> Analysis:
    """`items` must already be sorted by (make, model, comp_cat, date, id).

    With an `embedder`, alerts only match recalls whose description is semantically close to the
    alert's cluster (cosine >= bt_cfg.min_relevance)."""
    bt_cfg = bt_cfg or BacktestConfig()
    index = ComplaintIndex()
    relevance = None
    if embedder is not None and campaigns:
        texts = [prepare_text(f"{c.description} {c.consequence}") for c in campaigns]
        cvecs = {id(c): v for c, v in zip(campaigns, embedder.encode(texts))}
        relevance = lambda a, c: float(a.cluster.centroid @ cvecs[id(c)])  # noqa: E731

    def tee():
        for c, v in items:
            index.add(c)
            yield c, v

    clusters = list(cluster_stream(tee(), cfg))
    alerts = build_alerts(clusters, cfg)
    ev = evaluate(alerts, campaigns, index, bt_cfg, relevance)
    sw = sweep(clusters, campaigns, index, cfg, bt_cfg=bt_cfg, relevance=relevance)
    return Analysis(clusters, ev, sw, index, cfg, bt_cfg)


def embed_all(complaints: list[Complaint], embedder: Embedder, batch: int = 512) -> np.ndarray:
    parts = []
    for i in range(0, len(complaints), batch):
        parts.append(embedder.encode([prepare_text(c.text) for c in complaints[i : i + batch]]))
        if len(complaints) > 5000 and (i // batch) % 10 == 9:
            print(f"    embedded {i + batch:,}/{len(complaints):,}", flush=True)
    return np.vstack(parts) if parts else np.zeros((0, 384), dtype=np.float32)


def _timeline(members) -> list[dict]:
    counts = Counter(m.date.strftime("%Y-%m") for m in members)
    first, last = min(counts), max(counts)
    y, m = map(int, first.split("-"))
    out = []
    while f"{y:04d}-{m:02d}" <= last:
        key = f"{y:04d}-{m:02d}"
        out.append({"month": key, "count": counts.get(key, 0)})
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def _camp_doc(c: Campaign | None) -> dict | None:
    if c is None:
        return None
    return {
        "camp_no": c.camp_no, "report_date": c.report_date.isoformat(), "component": c.component,
        "years": list(c.years), "description": c.description[:600], "potentially_affected": c.potentially_affected,
    }


def build_snapshot(
    an: Analysis,
    fetch: Callable[[list[int]], Mapping[int, Complaint]],
    summarizer: Summarizer,
    meta: dict,
) -> dict:
    """Assemble the JSON served by the API / dashboard (and exported for the static demo)."""
    outcomes = sorted(an.evaluation.alerts, key=lambda o: o.alert.alert_date)
    alerts = [o.alert for o in outcomes]
    ids = sorted({i for a in alerts for i in a.evidence_ids})
    texts = fetch(ids)
    sums = summaries_for(alerts, texts, summarizer)

    alert_docs = []
    for i, o in enumerate(outcomes):
        a, s = o.alert, sums[i]
        ev = [texts[x] for x in a.evidence_ids if x in texts]
        alert_docs.append({
            "id": i + 1, "make": a.make, "model": a.model, "component": a.comp_cat, "years": list(a.years),
            "alert_date": a.alert_date.isoformat(), "first_date": a.first_date.isoformat(),
            "n_window": a.n_window, "severe_window": a.severe_window, "score": a.score,
            "cluster_size": len(a.cluster.members), "merged_count": a.merged_count,
            "keywords": keywords([c.text for c in ev]),
            "summary": {"text": s.text, "mode": s.mode, "grounded": s.grounding.ok, "issues": s.grounding.issues},
            "evidence": [
                {"id": c.id, "date": c.date_received.isoformat(), "year": c.year, "severe": c.severe, "text": c.text[:600]}
                for c in ev
            ],
            "timeline": _timeline(a.cluster.members),
            "outcome": o.outcome,
            "campaign": _camp_doc(o.campaign),
            "lead_weeks": round(o.lead_days / 7, 1) if o.lead_days is not None else None,
        })

    alert_id_by_key = {(o.alert.make, o.alert.model, o.alert.comp_cat, o.alert.alert_date): i + 1 for i, o in enumerate(outcomes)}
    camp_docs = []
    for r in sorted(an.evaluation.campaigns, key=lambda r: r.campaign.report_date):
        c = r.campaign
        camp_docs.append({
            **_camp_doc(c), "make": c.make, "model": c.model, "status": r.status, "addressable": r.addressable,
            "n_complaints_before": r.n_complaints_before,
            "lead_weeks": round(r.lead_days / 7, 1) if r.lead_days is not None else None,
            "alert_id": alert_id_by_key.get((r.alert.make, r.alert.model, r.alert.comp_cat, r.alert.alert_date)) if r.alert else None,
            "alert_date": r.alert.alert_date.isoformat() if r.alert else None,
        })

    leads = [r.lead_days / 7 for r in an.evaluation.campaigns if r.lead_days is not None]
    hist = [{"bin": label, "count": sum(lo <= w < hi for w in leads)} for lo, hi, label in LEAD_BINS]
    attempted = [s for s in sums.values() if s.llm_attempted and s.llm_grounded is not None]
    metrics = {
        **an.evaluation.metrics,
        "lead_histogram": hist,
        "sweep": an.sweep,
        "summaries": {
            "total": len(sums),
            "llm_summaries": sum(s.mode == "ollama" for s in sums.values()),
            "hallucination_rate_pct": round(100 * sum(not s.llm_grounded for s in attempted) / len(attempted), 1) if attempted else None,
            "final_grounded_pct": round(100 * sum(s.grounding.ok for s in sums.values()) / len(sums), 1) if sums else None,
        },
        "config": {k: v for k, v in asdict(an.cfg).items()} | {"warmup_days": an.bt_cfg.warmup_days, "horizon_days": an.bt_cfg.horizon_days,
                                                                "addressable_days": an.bt_cfg.addressable_days, "min_addressable": an.bt_cfg.min_addressable},
    }
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "meta": {
            **meta,
            "complaints": sum(len(v) for v in an.index._d.values()),
            "date_range": [an.index.first_date.isoformat(), an.index.last_date.isoformat()],
        },
        "metrics": metrics,
        "alerts": alert_docs,
        "campaigns": camp_docs,
    }


def write_snapshot(snapshot: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(snapshot, indent=1), encoding="utf-8")
