# Dataset

`creditcard.csv` is not committed (144 MB). Fetch it with `python ml/download_data.py`.

**Source.** "Credit Card Fraud Detection", Machine Learning Group, Université Libre de Bruxelles (ULB), also published on
Kaggle. 284,807 real card transactions made by European cardholders over two days in September 2013, 492 of them
fraudulent (0.172%). The features `V1`-`V28` are PCA components released instead of the original (confidential) fields;
`Time` is seconds since the first transaction and `Amount` is the transaction amount.

**License.** Database Contents License (DbCL) v1.0. Please cite: Dal Pozzolo, Caelen, Johnson, Bontempi,
*Calibrating Probability with Undersampling for Unbalanced Classification*, IEEE SSCI 2015.

`ml/sample/holdout_sample.csv.gz` is a small slice of the held-out (final 15%) period: all 52 frauds plus 3,000 randomly
chosen legitimate rows. The traffic simulator and a few tests replay it.
