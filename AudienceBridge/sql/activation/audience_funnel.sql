SELECT
  m.segment_name,
  COUNT(*) AS segment_size,
  COUNTIF(c.user_pseudo_id IS NOT NULL) AS matched_size,
  COUNTIF(c.consent_ok) AS consented_size,
  COUNTIF(c.consent_ok AND c.has_valid_id) AS valid_id_size,
  COUNTIF(c.consent_ok AND c.has_valid_id AND s.apply_holdout AND IFNULL(h.is_holdout, FALSE)) AS holdout_size,
  COUNTIF(c.consent_ok AND c.has_valid_id AND NOT (s.apply_holdout AND IFNULL(h.is_holdout, FALSE))) AS activatable_size
FROM `{{ project }}.ab_marts.segment_members` AS m
JOIN `{{ project }}.ab_marts.segments` AS s USING (segment_name)
LEFT JOIN `{{ project }}.ab_raw.crm_normalized` AS c USING (user_pseudo_id)
LEFT JOIN `{{ project }}.ab_marts.holdout_assignments` AS h USING (user_pseudo_id, segment_name)
GROUP BY m.segment_name;
