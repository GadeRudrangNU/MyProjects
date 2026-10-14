# CUSUM tuning

Output of `scripts/tune_cusum.py`. Each row is one choice of the reference value `k` and the decision threshold `h`, both in units of the noise standard deviation. "False alarm every" is the average time between alarms on pure noise at 10 samples per second (4,000 chains of 30,000 samples). The drift columns give the median time to alarm on a ramp of the stated rate, for a signal with the 5 mV noise of a battery cell. Deviations are clipped at 4 sigma. Where no false alarm was seen in the whole run the figure is a lower bound.

| k (sigma) | h (sigma) | false alarm every | drift 0.002 V/s | drift 0.005 V/s | drift 0.01 V/s | drift 0.05 V/s |
|---|---|---|---|---|---|---|
| 0.5 | 5 | 0.8 min per signal | 2.4s | 1.3s | 0.9s | 0.4s |
| 0.5 | 8 | 15.8 min per signal | 2.9s | 1.7s | 1.1s | 0.5s |
| 0.5 | 10 | 113.9 min per signal | 3.2s | 1.8s | 1.2s | 0.5s |
| 0.5 | 12 | 980.4 min per signal | 3.5s | 2.0s | 1.3s | 0.6s |
| 0.75 | 5 | 7.5 min per signal | 3.0s | 1.6s | 1.0s | 0.4s |
| 0.75 | 8 | 766.3 min per signal | 3.6s | 1.9s | 1.2s | 0.5s |
| 0.75 | 10 | 18181.8 min per signal | 3.8s | 2.1s | 1.3s | 0.5s |
| 0.75 | 12 | 200000.0 min per signal | 4.1s | 2.2s | 1.4s | 0.6s |
| 1.0 | 5 | 95.4 min per signal | 3.6s | 1.8s | 1.1s | 0.4s |
| 1.0 | 8 | 40000.0 min per signal | 4.2s | 2.1s | 1.3s | 0.5s |
| 1.0 | 10 | 200000.0 min per signal | 4.4s | 2.3s | 1.4s | 0.6s |
| 1.0 | 12 | 200000.0 min per signal | 4.7s | 2.5s | 1.6s | 0.7s |
