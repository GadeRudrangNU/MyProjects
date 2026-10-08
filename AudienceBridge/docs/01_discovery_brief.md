# Discovery brief

## Client and current state

The Google Merchandise Store (simulated) spends on broad Google Ads campaigns. It has web analytics in GA4 and a CRM, but none of that first-party knowledge reaches Google Ads. Cart abandoners, best customers and fresh purchasers are all treated the same.

## Objectives

1. Re-engage cart abandoners.
2. Reach high-value customers with premium offers.
3. Stop paying to show ads to people who just bought.
4. Prove whether this works before scaling budget.

## Stakeholders (simulated)

| Role | Cares about |
|---|---|
| Marketing lead | Return on ad spend, speed to launch |
| CRM owner | Data quality, match rates |
| Privacy and legal | Consent, hashing, retention |
| Agency | Campaign structure, creative |

## Constraints

- Only users who granted both ad-user-data and ad-personalisation consent may be activated.
- Identifiers must be normalised and SHA-256 hashed before they leave the warehouse.
- Weekly refresh is enough.
- No budget for paid tools; everything runs on free tiers.

## Success metrics

- Every activated audience meets the minimum list size (100 activatable members).
- At least one audience shows a statistically significant backtest lift of 1.5x or more.
- The A/A test shows no spurious difference between treated and holdout users.
- The pipeline runs weekly without manual steps and fails loudly on bad data.

## Open questions for a real client

- What share of site traffic is logged in, and how are CRM records keyed to web users?
- How are consent signals captured and when do they expire?
- Which campaign types and budgets are planned for the first flight?
- Is there an existing Customer Match setup to migrate?
- What retention period applies to customer data?
