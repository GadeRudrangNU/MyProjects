SELECT m.segment_name, o.is_eval,
  COUNT(*) AS n,
  COUNTIF(o.purchased_future) AS k,
  SUM(o.future_revenue_usd) AS revenue
FROM `{{ project }}.ab_marts.segment_members` AS m
JOIN `{{ project }}.ab_marts.future_outcomes` AS o USING (user_pseudo_id)
GROUP BY m.segment_name, o.is_eval;
