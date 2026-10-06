"""Backtest: did the detector warn before the manufacturer's recall report reached NHTSA?"""
from __future__ import annotations

import statistics
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Callable, Sequence

from .detect import ComplaintIndex
from .models import Alert, Campaign


@dataclass
class BacktestConfig:
    warmup_days: int = 180  # ignore the start of the dataset: clusters there have no history
    horizon_days: int = 548  # an alert counts as a hit if a matching recall follows within ~18 months
    addressable_days: int = 180  # a recall is "addressable by complaints" if at least
    min_addressable: int = 12  # this many matching complaints arrived in the days before it
    min_relevance: float = 0.0  # if a relevance function is given, alert text must resemble the recall


def _structural_match(alert: Alert, camp: Campaign) -> bool:
    return (
        alert.make == camp.make
        and alert.model == camp.model
        and alert.comp_cat in camp.comp_cats
        and bool(set(alert.years) & set(camp.years))
    )


@dataclass
class CampaignResult:
    campaign: Campaign
    status: str  # early | late | missed | no_data
    addressable: bool
    n_complaints_before: int
    alert: Alert | None = None
    lead_days: int | None = None


@dataclass
class AlertOutcome:
    alert: Alert
    outcome: str  # hit | already_recalled | miss | pending
    campaign: Campaign | None = None
    lead_days: int | None = None


@dataclass
class Evaluation:
    campaigns: list[CampaignResult]
    alerts: list[AlertOutcome]
    metrics: dict


def evaluate(
    alerts: Sequence[Alert],
    campaigns: Sequence[Campaign],
    index: ComplaintIndex,
    cfg: BacktestConfig | None = None,
    relevance: Callable[[Alert, Campaign], float] | None = None,
) -> Evaluation:
    """`relevance(alert, campaign)` is a text-similarity score; when given, a match also needs
    score >= cfg.min_relevance, so a spike about one defect cannot take credit for another."""
    cfg = cfg or BacktestConfig()

    def matches(a: Alert, c: Campaign) -> bool:
        return _structural_match(a, c) and (relevance is None or relevance(a, c) >= cfg.min_relevance)

    if index.first_date is None:
        raise ValueError("no complaints indexed")
    start = index.first_date + timedelta(days=cfg.warmup_days)
    end = index.last_date
    models = index.models()
    live = [a for a in alerts if a.alert_date >= start]

    results: list[CampaignResult] = []
    for camp in campaigns:
        if not (start <= camp.report_date <= end) or (camp.make, camp.model) not in models:
            continue
        n_before = index.count_before(
            camp.make, camp.model, camp.comp_cats, camp.years, camp.report_date, cfg.addressable_days
        )
        hits = sorted((a for a in live if matches(a, camp)), key=lambda a: a.alert_date)
        first = hits[0] if hits else None
        if first and first.alert_date < camp.report_date:
            status, lead = "early", (camp.report_date - first.alert_date).days
        elif first:
            status, lead = "late", None
        else:
            status, lead = "missed", None
        results.append(
            CampaignResult(camp, status, n_before >= cfg.min_addressable, n_before, first, lead)
        )

    outcomes: list[AlertOutcome] = []
    for a in live:
        related = [c for c in campaigns if matches(a, c)]
        prior = [c for c in related if c.report_date <= a.alert_date]
        after = sorted(
            (c for c in related if 0 < (c.report_date - a.alert_date).days <= cfg.horizon_days),
            key=lambda c: c.report_date,
        )
        if after:
            outcomes.append(AlertOutcome(a, "hit", after[0], (after[0].report_date - a.alert_date).days))
        elif prior:
            outcomes.append(AlertOutcome(a, "already_recalled", prior[-1]))
        elif (end - a.alert_date).days < cfg.horizon_days:
            outcomes.append(AlertOutcome(a, "pending"))
        else:
            outcomes.append(AlertOutcome(a, "miss"))

    return Evaluation(results, outcomes, summarize(results, outcomes))


def summarize(results: Sequence[CampaignResult], outcomes: Sequence[AlertOutcome]) -> dict:
    addressable = [r for r in results if r.addressable]
    early = [r for r in results if r.status == "early"]
    early_addr = [r for r in addressable if r.status == "early"]
    leads_w = sorted(r.lead_days / 7 for r in early if r.lead_days is not None)
    resolved = [o for o in outcomes if o.outcome in ("hit", "miss")]
    hits = [o for o in resolved if o.outcome == "hit"]
    pct = lambda a, b: round(100 * a / b, 1) if b else None  # noqa: E731
    return {
        "campaigns_total": len(results),
        "campaigns_addressable": len(addressable),
        "detected_early": len(early),
        "detected_early_addressable": len(early_addr),
        "detected_late": sum(r.status == "late" for r in results),
        "missed": sum(r.status == "missed" for r in results),
        "recall_pct_all": pct(len(early), len(results)),
        "recall_pct_addressable": pct(len(early_addr), len(addressable)),
        "lead_weeks_mean": round(statistics.mean(leads_w), 1) if leads_w else None,
        "lead_weeks_median": round(statistics.median(leads_w), 1) if leads_w else None,
        "alerts_total": len(outcomes),
        "alerts_hit": len(hits),
        "alerts_miss": len(resolved) - len(hits),
        "alerts_already_recalled": sum(o.outcome == "already_recalled" for o in outcomes),
        "alerts_pending": sum(o.outcome == "pending" for o in outcomes),
        "precision_pct": pct(len(hits), len(resolved)),
    }


def sweep(
    clusters, campaigns, index, base_cfg, min_counts=(5, 8, 10, 15, 20), bt_cfg: BacktestConfig | None = None,
    relevance=None,
) -> list[dict]:
    """Precision/recall trade-off as the alert threshold varies. Clustering is threshold-independent."""
    from dataclasses import replace

    from .detect import build_alerts

    rows = []
    for m in min_counts:
        cfg = replace(base_cfg, min_count=m)
        ev = evaluate(build_alerts(clusters, cfg), campaigns, index, bt_cfg, relevance)
        rows.append({"min_count": m, **{k: ev.metrics[k] for k in (
            "alerts_total", "precision_pct", "recall_pct_all", "recall_pct_addressable", "lead_weeks_mean")}})
    return rows
