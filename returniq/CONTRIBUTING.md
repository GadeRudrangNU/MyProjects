# Contributing

Thanks for taking a look. This is a portfolio prototype, but issues and PRs are welcome.

## Setup
See the "Running locally" section of the README. In short: `make setup && make pipeline`, then `make api` and `make web`.

## Ground rules
* **No invented numbers.** Any figure shown as a result must be computed from the dataset or the app. Hard-coded assumptions (simulator, experiment) must be labelled as assumptions.
* **No leakage.** New features must be computable strictly before the purchase timestamp. Add a test in `tests/test_features.py`.
* **Be honest about the target.** The label is "credit note matched within 30 days", not "return".
* Run `make test` before opening a PR (pytest + vitest).
