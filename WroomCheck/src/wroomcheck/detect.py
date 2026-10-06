"""Causal defect detection: streaming clustering + spike alerts.

Complaints are processed in chronological order inside each (make, model, component-category)
group. Each complaint joins the most similar existing cluster if cosine similarity >= threshold,
otherwise it opens a new cluster. Nothing about the future is used, so an alert's date is the
date it could really have been raised.

An alert fires the first time a cluster (a) accumulates `min_count` complaints inside a rolling
`window_days` window (or half that many if at least `severe_min` of them report a crash, fire,
injury or death) and (b) is genuinely spiking: the window count is at least `growth_min` times the
previous window's and exceeds the cluster's own long-run rate by `spike_z` Poisson sigmas.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import timedelta
from itertools import groupby
from typing import Iterable, Iterator

import numpy as np

from .models import Alert, Cluster, Complaint, Member


@dataclass
class DetectConfig:
    threshold: float = 0.55  # cosine similarity to join a cluster
    min_cluster_size: int = 3  # smaller clusters are discarded (they can never alert)
    window_days: int = 90
    min_count: int = 10
    severe_min: int = 2  # this many severe reports halve the count needed
    growth_min: float = 1.5  # window count must be >= this x the previous window's count
    spike_z: float = 3.0  # ...and exceed the cluster's long-run baseline by this many Poisson sigmas
    evidence_size: int = 8
    dedupe_days: int = 365


class _Centroids:
    """Growable matrix of unit-length cluster centroids."""

    def __init__(self, dim: int):
        self.sums = np.zeros((16, dim), dtype=np.float32)
        self.cent = np.zeros((16, dim), dtype=np.float32)
        self.n = 0

    def best(self, v: np.ndarray) -> tuple[int, float]:
        if self.n == 0:
            return -1, -1.0
        sims = self.cent[: self.n] @ v
        k = int(np.argmax(sims))
        return k, float(sims[k])

    def add(self, v: np.ndarray) -> int:
        if self.n == len(self.sums):
            self.sums = np.vstack([self.sums, np.zeros_like(self.sums)])
            self.cent = np.vstack([self.cent, np.zeros_like(self.cent)])
        self.sums[self.n] = v
        self.cent[self.n] = v
        self.n += 1
        return self.n - 1

    def update(self, k: int, v: np.ndarray) -> None:
        self.sums[k] += v
        norm = float(np.linalg.norm(self.sums[k]))
        self.cent[k] = self.sums[k] / max(norm, 1e-9)


def cluster_stream(
    items: Iterable[tuple[Complaint, np.ndarray]], cfg: DetectConfig
) -> Iterator[Cluster]:
    """`items` must be sorted by (make, model, comp_cat, date_received, id)."""
    key = lambda it: (it[0].make, it[0].model, it[0].comp_cat)  # noqa: E731
    for (make, model, cat), group in groupby(items, key=key):
        clusters: list[Cluster] = []
        cents: _Centroids | None = None
        for c, v in group:
            if cents is None:
                cents = _Centroids(len(v))
            k, sim = cents.best(v)
            if sim >= cfg.threshold:
                cents.update(k, v)
            else:
                k = cents.add(v)
                clusters.append(Cluster(make, model, cat))
                sim = 1.0
            clusters[k].members.append(Member(c.id, c.date_received, c.year, c.severe, sim))
        for k, cl in enumerate(clusters):
            if len(cl.members) >= cfg.min_cluster_size:
                cl.centroid = cents.cent[k].copy()
                yield cl


def _alert_for(cl: Cluster, cfg: DetectConfig) -> Alert | None:
    """Scan a cluster's members chronologically; return the first alert, if any."""
    half = math.ceil(cfg.min_count / 2)
    window = timedelta(days=cfg.window_days)
    lo = prev = 0  # window = members[lo..hi]; previous window = members[prev..lo-1]
    severe = 0
    for hi, m in enumerate(cl.members):
        severe += m.severe
        while cl.members[lo].date <= m.date - window:
            severe -= cl.members[lo].severe
            lo += 1
        while cl.members[prev].date <= m.date - 2 * window:
            prev += 1
        n, n_prev = hi - lo + 1, lo - prev
        # baseline = the cluster's own long-run rate (members older than two windows) per window
        elapsed = max((m.date - 2 * window - cl.members[0].date).days, cfg.window_days)
        baseline = prev * cfg.window_days / elapsed
        spiking = n >= cfg.growth_min * n_prev and n >= baseline + cfg.spike_z * math.sqrt(max(baseline, 1.0))
        if spiking and (n >= cfg.min_count or (n >= half and severe >= cfg.severe_min)):
            win = cl.members[lo : hi + 1]
            share: dict[int, int] = {}
            for w in win:
                share[w.year] = share.get(w.year, 0) + 1
            years = tuple(sorted(y for y, c in share.items() if c / n >= 0.15))
            # evidence: severe first, then closest to the cluster core
            ranked = sorted(win, key=lambda w: (not w.severe, -w.sim))
            return Alert(
                cluster=cl,
                alert_date=m.date,
                first_date=cl.members[0].date,
                years=years,
                n_window=n,
                severe_window=severe,
                score=round(n + 3 * severe, 1),
                evidence_ids=[w.id for w in ranked[: cfg.evidence_size]],
            )
    return None


def build_alerts(clusters: Iterable[Cluster], cfg: DetectConfig) -> list[Alert]:
    """Raise one alert per cluster, then fold near-duplicates (same make/model/component,
    overlapping years, close in time) into the earliest one."""
    raw = [a for cl in clusters if (a := _alert_for(cl, cfg))]
    raw.sort(key=lambda a: a.alert_date)
    kept: list[Alert] = []
    for a in raw:
        dup = next(
            (
                k
                for k in kept
                if (k.make, k.model, k.comp_cat) == (a.make, a.model, a.comp_cat)
                and set(k.years) & set(a.years)
                and (a.alert_date - k.alert_date).days <= cfg.dedupe_days
            ),
            None,
        )
        if dup:
            dup.merged_count += 1
        else:
            kept.append(a)
    return kept


class ComplaintIndex:
    """Per (make, model, comp_cat): complaint dates and model years, for backtest coverage checks."""

    def __init__(self) -> None:
        self._d: dict[tuple[str, str, str], list[tuple[int, int]]] = {}
        self.first_date = None
        self.last_date = None

    def add(self, c: Complaint) -> None:
        self._d.setdefault((c.make, c.model, c.comp_cat), []).append((c.date_received.toordinal(), c.year))
        if self.first_date is None or c.date_received < self.first_date:
            self.first_date = c.date_received
        if self.last_date is None or c.date_received > self.last_date:
            self.last_date = c.date_received

    def count_before(
        self, make: str, model: str, cats: Iterable[str], years: Iterable[int], before, days: int
    ) -> int:
        """Matching complaints received in the `days` before `before`."""
        ys, hi = set(years), before.toordinal()
        lo = hi - days
        return sum(
            1
            for cat in cats
            for d, y in self._d.get((make, model, cat), ())
            if lo <= d < hi and y in ys
        )

    def models(self) -> set[tuple[str, str]]:
        return {(m, mo) for m, mo, _ in self._d}
