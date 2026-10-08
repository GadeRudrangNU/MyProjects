CREATE OR REPLACE TABLE `{{ project }}.ab_marts.future_outcomes` AS
WITH future AS (
  SELECT
    user_pseudo_id,
    COUNT(*) AS purchases_future,
    SUM(purchase_revenue_usd) AS revenue_future
  FROM `{{ project }}.ab_staging.stg_ga4_events`
  WHERE event_name = 'purchase'
    AND event_date > DATE '{{ as_of }}'
    AND event_date <= DATE '{{ future_end }}'
  GROUP BY user_pseudo_id
)
SELECT
  f.user_pseudo_id,
  IFNULL(o.purchases_future, 0) > 0 AS purchased_future,
  IFNULL(o.revenue_future, 0.0) AS future_revenue_usd,
  MOD(ABS(FARM_FINGERPRINT(CONCAT(f.user_pseudo_id, ':eval'))), 100) < {{ eval_pct }} AS is_eval
FROM `{{ project }}.ab_marts.user_features` AS f
LEFT JOIN future AS o USING (user_pseudo_id);
