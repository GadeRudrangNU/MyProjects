CREATE OR REPLACE TABLE `{{ project }}.ab_staging.stg_ga4_events` AS
SELECT
  PARSE_DATE('%Y%m%d', event_date) AS event_date,
  event_name,
  user_pseudo_id,
  device.category AS device_category,
  geo.country AS country,
  traffic_source.medium AS traffic_medium,
  IFNULL(ecommerce.purchase_revenue_in_usd, 0.0) AS purchase_revenue_usd,
  (SELECT COUNTIF(LOWER(i.item_category) LIKE 'apparel%') FROM UNNEST(items) AS i) AS apparel_items
FROM `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
WHERE _TABLE_SUFFIX BETWEEN '{{ start_suffix }}' AND '{{ end_suffix }}'
  AND user_pseudo_id IS NOT NULL;
