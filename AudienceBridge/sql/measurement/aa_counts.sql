SELECT m.segment_name, h.is_holdout,
  COUNT(*) AS n,
  COUNTIF(o.purchased_future) AS k
FROM `{{ project }}.ab_marts.segment_members` AS m
JOIN `{{ project }}.ab_marts.holdout_assignments` AS h USING (user_pseudo_id, segment_name)
JOIN `{{ project }}.ab_marts.future_outcomes` AS o USING (user_pseudo_id)
GROUP BY m.segment_name, h.is_holdout;
