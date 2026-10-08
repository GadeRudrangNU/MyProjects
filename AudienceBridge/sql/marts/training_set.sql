CREATE OR REPLACE TABLE `{{ project }}.ab_marts.training_set` AS
SELECT
  f.user_pseudo_id,
  f.sessions,
  f.item_views,
  f.add_to_carts,
  f.purchases,
  f.revenue_usd,
  f.days_since_last_seen,
  IFNULL(f.device_category, 'unknown') AS device_category,
  IFNULL(f.country, 'unknown') AS country,
  CAST(o.purchased_future AS INT64) AS purchased_next_month,
  o.is_eval
FROM `{{ project }}.ab_marts.user_features` AS f
JOIN `{{ project }}.ab_marts.future_outcomes` AS o USING (user_pseudo_id);
