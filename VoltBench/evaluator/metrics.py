import math
from collections import defaultdict

ALL_KINDS = (
    "range_check", "stability_check", "spike_check", "ack_latency",
    "response_time", "link_quality", "heartbeat_recovery", "firmware_check",
)

# Which tests are expected to flag each fault. Spikes and drift also disturb the
# spread of the signal, so stability_check is expected to react to them as well.
CATCHES = {
    "drift": {"range_check", "stability_check", "spike_check"},
    "stuck_value": {"stability_check", "response_time"},
    "out_of_range_spike": {"spike_check", "stability_check"},
    "packet_drop": {"link_quality"},
    "crc_corruption": {"link_quality"},
    "latency_spike": {"ack_latency"},
    "hang": set(ALL_KINDS),
    "slow_response": {"response_time"},
    "wrong_firmware": {"firmware_check"},
}

# Real-time monitor rules that can see each fault. Latency, response time and
# firmware faults are invisible to the stream monitors by design.
MONITOR_RULES = {
    "drift": {"cusum_drift", "hard_limit"},
    "stuck_value": {"stuck_value"},
    "out_of_range_spike": {"hard_limit", "cusum_drift"},
    "packet_drop": {"rolling_loss"},
    "crc_corruption": {"rolling_loss"},
    "hang": {"stale_signal"},
}


def percentile(values, p):
    """Nearest-rank percentile."""
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(p / 100 * len(ordered)) - 1)]


def rate(num, den):
    return num / den if den else None


def confusion(rows):
    tp = sum(1 for r in rows if r["actual"] and r["predicted"])
    fn = sum(1 for r in rows if r["actual"] and not r["predicted"])
    fp = sum(1 for r in rows if not r["actual"] and r["predicted"])
    tn = sum(1 for r in rows if not r["actual"] and not r["predicted"])
    precision = rate(tp, tp + fp)
    recall = rate(tp, tp + fn)
    f1 = 2 * precision * recall / (precision + recall) if precision and recall else None
    return {
        "tp": tp, "fn": fn, "fp": fp, "tn": tn,
        "precision": precision, "recall": recall, "f1": f1,
        "false_alarm_rate": rate(fp, fp + tn),
    }


def label_rows(results, faults):
    """Join test results against ground truth faults by device and time overlap."""
    by_device = defaultdict(list)
    for f in faults:
        by_device[f["device_id"]].append(f)
    rows = []
    for r in results:
        if r["verdict"] == "ERROR":
            continue
        active = [
            f for f in by_device.get(r["device_id"], [])
            if f["start_at"] <= r["ended_at"] and f["end_at"] >= r["started_at"]
        ]
        causes = [f for f in active if r["kind"] in CATCHES[f["type"]]]
        rows.append({
            **r,
            "actual": bool(causes),
            "predicted": r["verdict"] == "FAIL",
            "fault_types": sorted({f["type"] for f in causes}),
            "fault_ids": [f["id"] for f in causes],
            "any_fault": bool(active),
        })
    return rows


def per_fault_type(rows, faults):
    out = {}
    for ftype in CATCHES:
        subset = [r for r in rows if ftype in r["fault_types"]]
        tp = sum(1 for r in subset if r["predicted"])
        out[ftype] = {
            "injected": sum(1 for f in faults if f["type"] == ftype),
            "tp": tp,
            "fn": len(subset) - tp,
            "recall": rate(tp, len(subset)),
        }
    return out


def bucket_edges(lo, hi, n):
    return [lo + (hi - lo) * i / n for i in range(n + 1)]


def detection_by_severity(faults, detected_by_test, detected_by_monitor, spec, buckets=5):
    """Detection rate per severity bucket for each fault type that has a severity range."""
    out = {}
    for ftype, fspec in spec.items():
        subset = [f for f in faults if f["type"] == ftype]
        if not subset:
            continue
        lo, hi = fspec["min"], fspec["max"]
        if lo == hi:
            out[ftype] = [{
                "lo": lo, "hi": hi, "n": len(subset),
                "test_rate": rate(sum(1 for f in subset if detected_by_test.get(f["id"])), len(subset)),
                "monitor_rate": rate(sum(1 for f in subset if detected_by_monitor.get(f["id"]) is not None), len(subset))
                if ftype in MONITOR_RULES else None,
            }]
            continue
        edges = bucket_edges(lo, hi, buckets)
        rows = []
        for i in range(buckets):
            last = i == buckets - 1
            members = [f for f in subset if edges[i] <= f["severity"] < edges[i + 1] or (last and f["severity"] == hi)]
            rows.append({
                "lo": edges[i], "hi": edges[i + 1], "n": len(members),
                "test_rate": rate(sum(1 for f in members if detected_by_test.get(f["id"])), len(members)),
                "monitor_rate": rate(sum(1 for f in members if detected_by_monitor.get(f["id"]) is not None), len(members))
                if ftype in MONITOR_RULES else None,
            })
        out[ftype] = rows
    return out


def time_to_detect(faults, alerts):
    """Seconds from fault start to the first matching monitor alert, or None if never raised."""
    by_device = defaultdict(list)
    for a in alerts:
        by_device[a["device_id"]].append(a)
    out = {}
    for f in faults:
        rules = MONITOR_RULES.get(f["type"])
        if not rules:
            continue
        hits = [
            a["ts"] - f["start_at"] for a in by_device.get(f["device_id"], [])
            if a["rule"] in rules and f["start_at"] <= a["ts"] <= f["end_at"]
        ]
        out[f["id"]] = min(hits) if hits else None
    return out


def histogram(values, bins):
    if not values:
        return []
    top = max(values)
    width = top / bins if top > 0 else 1
    counts = [0] * bins
    for v in values:
        counts[min(bins - 1, int(v / width))] += 1
    return [{"lo": i * width, "hi": (i + 1) * width, "count": c} for i, c in enumerate(counts)]
