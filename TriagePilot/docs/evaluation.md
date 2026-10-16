# Evaluation

Data: IT Service Ticket Classification Dataset (CC0), 47,837 unique tickets, stratified 80/20 split (38,269 train, 9,568 test).
Language model: `qwen2.5:7b` through Ollama, temperature 0. Similar-ticket search for held-out tickets leaves the test split out.

## Classifier on the whole test split

Accuracy 0.860, macro-F1 0.862.

| Category | F1 |
|---|---|
| Access | 0.895 |
| Administrative rights | 0.770 |
| HR Support | 0.867 |
| Hardware | 0.845 |
| Internal Project | 0.868 |
| Miscellaneous | 0.826 |
| Purchase | 0.927 |
| Storage | 0.900 |

## Confidence threshold

| Threshold | Share of tickets above it | Accuracy above it |
|---|---|---|
| 0.50 | 92.0% | 89.5% |
| 0.60 | 80.8% | 93.0% |
| 0.70 | 69.4% | 95.9% |
| 0.80 | 54.7% | 97.8% |
| 0.85 | 44.9% | 98.5% |
| 0.90 | 32.2% | 99.4% |
| 0.95 | 13.5% | 99.8% |

The threshold is a system property (`x_tp.auto_route_threshold`), so it can be changed without touching code.

## Three-way comparison (799 held-out tickets, 100 per category scaled to the split)

| | Accuracy | Macro-F1 |
|---|---|---|
| Classifier | 0.836 | 0.847 |
| LLM zero-shot | 0.539 | 0.561 |
| Hybrid | 0.815 | 0.828 |

Fast path: 39.7% of tickets, 98.7% accurate. LLM path: 482 tickets, classifier 73.7%, hybrid 70.1%.
The category descriptions given to the model were written from the most distinctive words of each category in the training data.

## Hand-written tickets (40, five per category)

Classifier 0.925 accuracy / 0.923 macro-F1, zero-shot 0.925 / 0.923, hybrid 1.000 / 1.000. 72.5% went down the fast path, all correct.

My first version of this set used everyday meanings for the categories and the classifier scored 32.5%. Looking at the training data
showed the categories are narrower than their names (for example, "Administrative rights" is mostly software installs, upgrades and
version errors, and "Storage" is mostly shared mailbox and folder permissions). I rewrote the tickets to follow what the data
means and left the classifier untouched. Because the second set was written after that reading, it is easier than tickets from real users.

## Live replay (200 held-out tickets)

Each ticket is created in ServiceNow, triaged by the agent, then resolved with its true category, one at a time.

| | |
|---|---|
| Failed runs | 0 |
| Runs sent to a person because validation failed twice | 1 |
| Validator stepped in (retry) | 3 |
| Replies citing an article that was not retrieved | 0 |
| Routed automatically | 83 (41.5%) |
| Accuracy of the automatic routes | 97.6% |
| Accuracy of all suggestions | 77.5% |
| Fast path share | 42.0% |
| Latency p50 / p95 | 6.3 s / 8.8 s |

All priorities were 3 in this test so the result reflects the model and not the priority rule.
