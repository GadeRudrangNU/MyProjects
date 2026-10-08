CREATE OR REPLACE TABLE `{{ project }}.ab_raw.crm_normalized` AS
WITH n AS (
  SELECT
    user_pseudo_id,
    {{ email_expr }} AS email_n,
    {{ phone_expr }} AS phone_n,
    {{ name_expr_first }} AS first_n,
    {{ name_expr_last }} AS last_n,
    UPPER(TRIM(country_code)) AS region_code,
    NULLIF(TRIM(postal_code), '') AS postal_code,
    IFNULL(consent_ad_user_data, FALSE) AND IFNULL(consent_ad_personalization, FALSE) AS consent_ok
  FROM `{{ project }}.ab_raw.crm_customers`
)
SELECT *, (email_n IS NOT NULL OR phone_n IS NOT NULL) AS has_valid_id
FROM n;
