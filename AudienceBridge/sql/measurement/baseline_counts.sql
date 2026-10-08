SELECT o.is_eval,
  COUNT(*) AS n,
  COUNTIF(o.purchased_future) AS k,
  SUM(o.future_revenue_usd) AS revenue
FROM `{{ project }}.ab_marts.future_outcomes` AS o
GROUP BY o.is_eval;
