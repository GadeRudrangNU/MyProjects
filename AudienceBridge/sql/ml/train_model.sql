CREATE OR REPLACE MODEL `{{ project }}.ab_marts.purchase_propensity`
OPTIONS (
  model_type = 'logistic_reg',
  input_label_cols = ['purchased_next_month'],
  auto_class_weights = TRUE,
  data_split_method = 'CUSTOM',
  data_split_col = 'is_eval'
) AS
SELECT
  sessions, item_views, add_to_carts, purchases, revenue_usd,
  days_since_last_seen, device_category, country,
  purchased_next_month, is_eval
FROM `{{ project }}.ab_marts.training_set`;
