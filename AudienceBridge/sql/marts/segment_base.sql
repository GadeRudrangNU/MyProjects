CREATE OR REPLACE TABLE `{{ project }}.ab_marts.segment_base` AS
SELECT f.*{{ propensity_select }}
FROM `{{ project }}.ab_marts.user_features` AS f
{{ propensity_join }};
