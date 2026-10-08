CREATE OR REPLACE TABLE `{{ project }}.ab_measurement.dashboard_summary` AS
SELECT
  s.segment_name,
  s.objective,
  s.size AS segment_size,
  s.revenue_share,
  a.matched_size,
  a.consented_size,
  a.activatable_size,
  a.holdout_size,
  a.meets_min,
  b.purchase_rate,
  b.baseline_rate,
  b.lift_index,
  b.p_value AS lift_p_value,
  b.revenue_per_user,
  aa.p_value AS aa_p_value,
  aa.passes AS aa_passes
FROM `{{ project }}.ab_marts.segments` AS s
LEFT JOIN `{{ project }}.ab_activation.audience_summary` AS a USING (segment_name)
LEFT JOIN `{{ project }}.ab_measurement.segment_backtest` AS b USING (segment_name)
LEFT JOIN `{{ project }}.ab_measurement.aa_test_results` AS aa USING (segment_name);
