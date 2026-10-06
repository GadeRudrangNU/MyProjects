"""Plain dataclasses shared by every stage of the pipeline."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date


@dataclass(slots=True)
class Complaint:
    id: int
    make: str
    model: str
    year: int
    component: str  # full NHTSA component string
    comp_cat: str  # top-level category, e.g. "AIR BAGS"
    date_received: date  # NHTSA DATEA: the date the complaint became visible to NHTSA
    fail_date: date | None
    text: str
    crash: bool = False
    fire: bool = False
    injured: int = 0
    deaths: int = 0

    @property
    def severe(self) -> bool:
        return self.crash or self.fire or self.injured > 0 or self.deaths > 0


@dataclass(slots=True)
class Campaign:
    """One recall campaign for one make/model (NHTSA lists one row per model/year/component)."""

    camp_no: str
    make: str
    model: str
    years: tuple[int, ...]
    comp_cats: tuple[str, ...]
    report_date: date  # RCDATE: date the manufacturer's report was received by NHTSA
    component: str = ""
    description: str = ""
    consequence: str = ""
    remedy: str = ""
    potentially_affected: int = 0


@dataclass(slots=True)
class Member:
    id: int
    date: date
    year: int
    severe: bool
    sim: float  # cosine similarity to the centroid at the time of assignment


@dataclass
class Cluster:
    make: str
    model: str
    comp_cat: str
    members: list[Member] = field(default_factory=list)  # chronological
    centroid: object = None  # unit-length numpy vector; used only to match alerts to recall text


@dataclass
class Alert:
    cluster: Cluster
    alert_date: date
    first_date: date
    years: tuple[int, ...]
    n_window: int
    severe_window: int
    score: float
    evidence_ids: list[int]
    merged_count: int = 1  # how many near-duplicate clusters were folded into this alert

    @property
    def make(self) -> str:
        return self.cluster.make

    @property
    def model(self) -> str:
        return self.cluster.model

    @property
    def comp_cat(self) -> str:
        return self.cluster.comp_cat
