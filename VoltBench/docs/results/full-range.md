## Validation results: campaign full-range

30 devices, 12 runs, seed 42, about 30% of devices left clean each run. 252 faults injected, 2760 test results scored.

| Metric | Result | Target |
|---|---|---|
| Detection rate (recall) | 85.1% | >= 95% |
| Precision | 100.0% | >= 95% |
| False alarm rate | 0.0% | <= 2% |
| F1 | 92.0% | |
| Fault coverage | 9/9 | all types |
| Device-level detection | 88.5% | |
| Flaky rate | 0.18% | <= 1% |
| Infra error rate | 0.00% | <= 0.5% |
| Monitor detection (visible faults) | 90.6% | |
| Monitor false alarms (clean device-runs) | 0.0% | |
| Mean time to detect | 5.5s (median 1.5s, p95 37.9s) | |

| Fault type | Injected | Caught by tests | Recall |
|---|---|---|---|
| drift | 35 | 42 of 105 | 40.0% |
| stuck_value | 23 | 39 of 39 | 100.0% |
| out_of_range_spike | 28 | 52 of 56 | 92.9% |
| packet_drop | 23 | 22 of 23 | 95.7% |
| crc_corruption | 27 | 27 of 27 | 100.0% |
| latency_spike | 35 | 26 of 35 | 74.3% |
| hang | 24 | 183 of 183 | 100.0% |
| slow_response | 26 | 25 of 26 | 96.2% |
| wrong_firmware | 31 | 31 of 31 | 100.0% |
