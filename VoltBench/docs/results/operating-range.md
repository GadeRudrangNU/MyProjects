## Validation results: campaign operating-range

30 devices, 8 runs, seed 43, about 30% of devices left clean each run. 168 faults injected, 1840 test results scored.

| Metric | Result | Target |
|---|---|---|
| Detection rate (recall) | 93.8% | >= 95% |
| Precision | 100.0% | >= 95% |
| False alarm rate | 0.0% | <= 2% |
| F1 | 96.8% | |
| Fault coverage | 9/9 | all types |
| Device-level detection | 95.8% | |
| Flaky rate | 0.11% | <= 1% |
| Infra error rate | 0.00% | <= 0.5% |
| Monitor detection (visible faults) | 95.0% | |
| Monitor false alarms (clean device-runs) | 0.0% | |
| Mean time to detect | 3.9s (median 1.5s, p95 17.4s) | |

| Fault type | Injected | Caught by tests | Recall |
|---|---|---|---|
| drift | 17 | 28 of 51 | 54.9% |
| stuck_value | 30 | 50 of 50 | 100.0% |
| out_of_range_spike | 16 | 32 of 32 | 100.0% |
| packet_drop | 16 | 16 of 16 | 100.0% |
| crc_corruption | 21 | 21 of 21 | 100.0% |
| latency_spike | 18 | 18 of 18 | 100.0% |
| hang | 20 | 154 of 154 | 100.0% |
| slow_response | 12 | 12 of 12 | 100.0% |
| wrong_firmware | 18 | 18 of 18 | 100.0% |
