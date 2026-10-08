CREATE OR REPLACE TABLE `{{ project }}.ab_activation.activation_ready` AS
SELECT
  m.segment_name,
  TO_HEX(SHA256(c.email_n)) AS hashed_email,
  TO_HEX(SHA256(c.phone_n)) AS hashed_phone,
  TO_HEX(SHA256(c.first_n)) AS hashed_first_name,
  TO_HEX(SHA256(c.last_n)) AS hashed_last_name,
  c.region_code,
  c.postal_code
FROM `{{ project }}.ab_marts.segment_members` AS m
JOIN `{{ project }}.ab_raw.crm_normalized` AS c USING (user_pseudo_id)
JOIN `{{ project }}.ab_marts.segments` AS s USING (segment_name)
LEFT JOIN `{{ project }}.ab_marts.holdout_assignments` AS h USING (user_pseudo_id, segment_name)
WHERE c.consent_ok
  AND c.has_valid_id
  AND NOT (s.apply_holdout AND IFNULL(h.is_holdout, FALSE));
