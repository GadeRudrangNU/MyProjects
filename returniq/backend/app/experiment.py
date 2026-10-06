from __future__ import annotations

import math
from statistics import NormalDist


def sample_size_per_arm(baseline: float, relative_reduction: float, alpha: float = 0.05, power: float = 0.80) -> dict:
    if not 0 < baseline < 1:
        raise ValueError("baseline must be in (0, 1)")
    if not 0 < relative_reduction < 1:
        raise ValueError("relative_reduction must be in (0, 1)")
    p1, p2 = baseline, baseline * (1 - relative_reduction)
    pbar = (p1 + p2) / 2
    z_a, z_b = NormalDist().inv_cdf(1 - alpha / 2), NormalDist().inv_cdf(power)
    n = (z_a * math.sqrt(2 * pbar * (1 - pbar)) + z_b * math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2 / (p1 - p2) ** 2
    return {"n_per_arm": math.ceil(n), "p_control": p1, "p_treatment": p2, "absolute_difference": p1 - p2,
            "alpha": alpha, "power": power}


def duration_weeks(n_per_arm: int, eligible_orders_per_week: float, exposure_share: float = 1.0) -> float | None:
    flow = eligible_orders_per_week * exposure_share
    return None if flow <= 0 else (2 * n_per_arm) / flow
