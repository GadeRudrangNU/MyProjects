CREATE OR REPLACE TABLE `{{ project }}.ab_marts.propensity_scores` AS
SELECT
  user_pseudo_id,
  (SELECT p.prob FROM UNNEST(predicted_purchased_next_month_probs) AS p WHERE p.label = 1) AS propensity_score
FROM ML.PREDICT(
  MODEL `{{ project }}.ab_marts.purchase_propensity`,
  (SELECT * FROM `{{ project }}.ab_marts.training_set`)
);
