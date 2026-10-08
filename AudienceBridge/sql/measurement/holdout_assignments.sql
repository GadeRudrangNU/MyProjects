CREATE OR REPLACE TABLE `{{ project }}.ab_marts.holdout_assignments` AS
SELECT
  user_pseudo_id,
  segment_name,
  MOD(ABS(FARM_FINGERPRINT(CONCAT(user_pseudo_id, ':', segment_name, ':{{ holdout_salt }}'))), 100) < {{ holdout_pct }} AS is_holdout
FROM `{{ project }}.ab_marts.segment_members`;
