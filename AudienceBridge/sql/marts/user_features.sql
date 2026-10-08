CREATE OR REPLACE TABLE `{{ project }}.ab_marts.user_features` AS
SELECT
  user_pseudo_id,
  MIN(event_date) AS first_seen,
  MAX(event_date) AS last_seen,
  COUNTIF(event_name = 'session_start') AS sessions,
  COUNTIF(event_name = 'view_item') AS item_views,
  COUNTIF(event_name = 'add_to_cart') AS add_to_carts,
  COUNTIF(event_name = 'purchase') AS purchases,
  SUM(IF(event_name = 'purchase', purchase_revenue_usd, 0.0)) AS revenue_usd,
  MAX(IF(event_name = 'add_to_cart', event_date, NULL)) AS last_cart_date,
  MAX(IF(event_name = 'purchase', event_date, NULL)) AS last_purchase_date,
  COUNTIF(event_name = 'view_item' AND apparel_items > 0) AS apparel_views,
  DATE_DIFF(DATE '{{ as_of }}', MAX(event_date), DAY) AS days_since_last_seen,
  ARRAY_AGG(device_category IGNORE NULLS ORDER BY event_date DESC LIMIT 1)[SAFE_OFFSET(0)] AS device_category,
  ARRAY_AGG(country IGNORE NULLS ORDER BY event_date DESC LIMIT 1)[SAFE_OFFSET(0)] AS country
FROM `{{ project }}.ab_staging.stg_ga4_events`
WHERE event_date <= DATE '{{ as_of }}'
GROUP BY user_pseudo_id;
