"""Synthetic NHTSA-like world for the offline demo and tests.

All makes and models are FICTIONAL so nothing here implies a real defect. The world contains:
  * chronic background noise in every make/model/component,
  * planted defects whose complaints ramp up months before a recall is filed (detectable),
  * decoy spikes that never become recalls (false-positive bait),
  * "silent" recalls found by the manufacturer with almost no complaints (undetectable).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

import numpy as np

from .models import Campaign, Complaint
from .nhtsa import comp_category

START, END = date(2018, 1, 1), date(2024, 12, 31)

MODELS = {  # (make, model): (first model year, last model year)
    ("NOVA AUTO", "AURORA"): (2017, 2023),
    ("NOVA AUTO", "COMET"): (2020, 2024),
    ("ACME MOTORS", "ROADRUNNER"): (2016, 2022),
    ("ACME MOTORS", "HAULER"): (2017, 2023),
    ("TERRA CARS", "TRAILBOSS"): (2019, 2024),
    ("TERRA CARS", "SCOUT"): (2018, 2022),
    ("VELOCE", "STRADA"): (2017, 2023),
}

NOISE = {
    "ELECTRICAL SYSTEM:BATTERY": ["battery terminal corroded and the cable needed replacing", "alternator whined and the voltage gauge fluctuated", "key fob stopped unlocking the doors until the coin cell was changed", "interior lights flickered after washing the exterior"],
    "FUEL SYSTEM:GASOLINE": ["gas cap warning light came on after refueling", "fuel gauge reads empty with half a tank", "fuel door release stuck closed in cold weather", "slow fill with the pump clicking off repeatedly"],
    "AIR BAGS:FRONTAL": ["seat occupancy sensor light blinked on the passenger side", "clock spring squeaked when turning the wheel", "airbag cover trim panel came loose", "seat belt pretensioner light stayed lit briefly at startup"],
    "POWER TRAIN:AUTOMATIC TRANSMISSION": ["shift lever felt notchy between park and reverse", "hard shift into first gear when cold", "transmission fluid seeped from the pan gasket", "delayed engagement after sitting overnight"],
    "SERVICE BRAKES, HYDRAULIC:FOUNDATION COMPONENTS": ["rotors warped and the pedal pulsated at highway speed", "brake pads wore out at thirty thousand miles", "squealing from the front brakes in the morning", "parking brake cable stretched and needed adjusting"],
    "STEERING:GEARS": ["power steering fluid leaked at the hose clamp", "steering wheel off center after an alignment", "wheel vibrated at seventy miles per hour", "tie rod end boot cracked and torn"],
    "ENGINE:GASOLINE": ["check engine light came on for a loose sensor", "oil consumption higher than expected between changes", "valve cover gasket seeped oil", "rough idle at stoplights until the spark plugs were replaced"],
    "SUSPENSION:FRONT": ["control arm bushing worn out early", "alignment would not hold and tires wore on the inside edge", "sway bar link rattled on gravel roads", "shock absorber leaked fluid"],
    "VISIBILITY:WINDSHIELD WIPER/WASHER": ["washer nozzle clogged and sprayed sideways", "wiper blade chattered across the glass", "rain sensor was erratic in light drizzle", "windshield cracked from a small stone chip"],
}
FILLER = ["I took it to the dealer.", "The dealer could not find anything wrong.", "The dealer said it was normal.", "I am worried about my family's safety.", "This has now happened several times.", "I contacted the manufacturer customer service.", "The repair was not covered under warranty.", "I would like NHTSA to look into this."]


@dataclass
class Defect:
    make: str
    model: str
    years: tuple[int, ...]
    component: str
    symptoms: list[str]
    onset: date
    peak_per_month: float
    ramp_months: int
    recall_lag_days: int | None  # None = decoy that is never recalled
    severe_prob: float = 0.05
    tail_days: int = 60  # complaints keep arriving after the recall


DEFECTS = [
    Defect("NOVA AUTO", "AURORA", (2019, 2020), "ELECTRICAL SYSTEM:BATTERY", ["the twelve volt battery drained overnight and the car would not start", "the dashboard showed a battery warning and then power steering assist was lost", "the car died in traffic after the battery warning light flashed"], date(2019, 6, 1), 22, 5, 300, 0.10),
    Defect("ACME MOTORS", "ROADRUNNER", (2018, 2019), "FUEL SYSTEM:GASOLINE", ["the engine stalled at highway speed with no warning", "there was a strong smell of raw gasoline near the rear seat", "the fuel pump failed and the engine would not restart"], date(2020, 2, 1), 30, 4, 240, 0.30),
    Defect("TERRA CARS", "TRAILBOSS", (2021, 2022), "AIR BAGS:FRONTAL", ["the airbag warning light stayed on constantly", "the airbag did not deploy in a frontal collision", "the passenger airbag was disabled by the occupant sensor for no reason"], date(2021, 9, 1), 15, 5, 330, 0.50),
    Defect("VELOCE", "STRADA", (2020, 2021, 2022), "POWER TRAIN:AUTOMATIC TRANSMISSION", ["the transmission slipped and jerked when shifting from second to third", "the transmission went into limp mode and would not exceed twenty miles per hour", "harsh gear changes and a flashing gear indicator on the dash"], date(2022, 1, 1), 25, 4, 200, 0.10),
    Defect("ACME MOTORS", "HAULER", (2019, 2020, 2021), "SERVICE BRAKES, HYDRAULIC:FOUNDATION COMPONENTS", ["the brake pedal went soft and sank to the floor", "brake fluid leaked from the rear caliper", "stopping distance increased and the brake warning light came on"], date(2021, 3, 1), 18, 5, 270, 0.35),
    Defect("NOVA AUTO", "COMET", (2022, 2023), "STEERING:GEARS", ["the steering wheel locked up while turning at low speed", "the steering rack made a loud clunking noise and felt loose", "steering effort suddenly became very heavy"], date(2023, 2, 1), 20, 3, 150, 0.25),
    # decoys: noisy spikes that never became recalls
    Defect("TERRA CARS", "SCOUT", (2020,), "VISIBILITY:WINDSHIELD WIPER/WASHER", ["the wipers stopped working in heavy rain", "the wiper motor made a grinding noise then quit"], date(2020, 8, 1), 16, 3, None, 0.03),
    Defect("VELOCE", "STRADA", (2019, 2020), "ELECTRICAL SYSTEM:BATTERY", ["the infotainment screen froze and kept rebooting", "the touchscreen went black and the backup camera stopped working"], date(2021, 5, 1), 14, 3, None, 0.02),
    Defect("ACME MOTORS", "ROADRUNNER", (2020, 2021), "SUSPENSION:FRONT", ["the front strut mount rattled badly over bumps", "a loud knocking came from the front suspension on rough roads"], date(2022, 6, 1), 12, 3, None, 0.02),
]
SILENT_RECALLS = [  # manufacturer-initiated recalls with essentially no owner complaints
    ("NOVA AUTO", "AURORA", (2021,), "ENGINE:GASOLINE", date(2022, 4, 12)),
    ("TERRA CARS", "SCOUT", (2019, 2020), "STEERING:GEARS", date(2021, 2, 20)),
    ("ACME MOTORS", "HAULER", (2022,), "AIR BAGS:FRONTAL", date(2023, 3, 8)),
]


def _bump(day: date, defect: Defect, end_day: date) -> float:
    """Expected complaints per day: linear ramp to peak, hold, then decay after `end_day`."""
    months = (day - defect.onset).days / 30.0
    rate = defect.peak_per_month * min(1.0, 0.1 + months / max(defect.ramp_months, 1))
    if day > end_day:
        rate *= max(0.0, 1 - (day - end_day).days / defect.tail_days)
    return rate / 30.0


def generate(seed: int = 7) -> tuple[list[Complaint], list[Campaign]]:
    rng = np.random.default_rng(seed)
    def severe_flags(p):
        crash, fire = rng.random() < p * 0.5, rng.random() < p * 0.3
        return crash, fire, int(rng.random() < p * 0.2)

    complaints: list[Complaint] = []

    def add(day, make, model, year, comp, body, p):
        crash, fire, inj = severe_flags(p)
        fillers = rng.choice(FILLER, size=int(rng.integers(0, 3)), replace=False)
        text = f"MY {year} {make} {model}: {body}. " + " ".join(fillers)
        complaints.append(Complaint(0, make, model, year, comp, comp_category(comp), day,
                                    day - timedelta(days=int(rng.integers(1, 40))), text.upper(),
                                    crash, fire, inj, 0))

    total_days = (END - START).days
    for (make, model), (y0, y1) in MODELS.items():
        for comp, bodies in NOISE.items():
            per_day = float(rng.lognormal(mean=0.0, sigma=0.4)) / 30.0
            for d in range(total_days):
                for _ in range(rng.poisson(per_day)):
                    year = int(rng.integers(y0, y1 + 1))
                    add(START + timedelta(days=d), make, model, year, comp, str(rng.choice(bodies)), 0.03)

    campaigns: list[Campaign] = []
    seq = 0

    def campaign(make, model, years, comp, when, desc):
        nonlocal seq
        seq += 1
        campaigns.append(Campaign(f"{when.year % 100:02d}V{seq:03d}", make, model, tuple(sorted(years)),
                                  (comp_category(comp),), when, comp, desc,
                                  "THIS CONDITION MAY INCREASE THE RISK OF A CRASH.",
                                  "DEALERS WILL INSPECT AND REPLACE THE AFFECTED PARTS FREE OF CHARGE.",
                                  int(rng.integers(5_000, 80_000))))

    for df in DEFECTS:
        recall_day = df.onset + timedelta(days=df.recall_lag_days) if df.recall_lag_days else None
        end_day = recall_day or df.onset + timedelta(days=30 * (df.ramp_months + 2))
        d = df.onset
        while d <= min(END, end_day + timedelta(days=df.tail_days)):
            for _ in range(rng.poisson(_bump(d, df, end_day))):
                add(d, df.make, df.model, int(rng.choice(df.years)), df.component, str(rng.choice(df.symptoms)), df.severe_prob)
            d += timedelta(days=1)
        if recall_day:
            campaign(df.make, df.model, df.years, df.component, recall_day,
                     f"{df.make} IS RECALLING CERTAIN MODEL YEARS {df.model}. {df.symptoms[0].upper()}.")
    for make, model, years, comp, when in SILENT_RECALLS:
        for _ in range(3):  # a trickle of unrelated complaints
            add(when - timedelta(days=int(rng.integers(10, 200))), make, model, years[0], comp, str(rng.choice(NOISE[comp])), 0.05)
        campaign(make, model, years, comp, when, f"{make} FOUND A MANUFACTURING ISSUE IN {model}.")

    complaints.sort(key=lambda c: (c.date_received, c.make, c.model))
    for i, c in enumerate(complaints):
        c.id = 11_000_000 + i
    return complaints, sorted(campaigns, key=lambda c: c.report_date)


def write_flat_files(out_dir: Path, complaints: list[Complaint], campaigns: list[Campaign]) -> tuple[Path, Path]:
    """Write the world in the real NHTSA flat-file layout (tab-delimited, no header)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    f = lambda d: d.strftime("%Y%m%d") if d else ""  # noqa: E731
    cpath, rpath = out_dir / "FLAT_CMPL.txt", out_dir / "FLAT_RCL.txt"
    with open(cpath, "w", encoding="latin-1", newline="") as fh:
        for c in complaints:
            row = [""] * 49
            row[0], row[1], row[2], row[3], row[4], row[5] = str(c.id), str(c.id), c.make, c.make, c.model, str(c.year)
            row[6], row[7], row[8] = "Y" if c.crash else "N", f(c.fail_date), "Y" if c.fire else "N"
            row[9], row[10], row[11], row[15], row[19] = str(c.injured), str(c.deaths), c.component, f(c.date_received), c.text
            fh.write("\t".join(row) + "\n")
    with open(rpath, "w", encoding="latin-1", newline="") as fh:
        for k in campaigns:
            for y in k.years:
                row = [""] * 29
                row[0], row[1], row[2], row[3], row[4] = f"{k.camp_no}{y}", k.camp_no, k.make, k.model, str(y)
                row[6], row[10], row[11], row[15] = k.component, "V", str(k.potentially_affected), f(k.report_date)
                row[19], row[20], row[21] = k.description, k.consequence, k.remedy
                fh.write("\t".join(row) + "\n")
    return cpath, rpath
