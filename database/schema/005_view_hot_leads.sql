-- Ziarem Intelligence Engine: view of hot leads with Wolf / Dispute / Lyco tags.
-- Joins raw_leads with dict_occupations and dict_doc_types; filters to leads matching at least one tag.
-- Run after 004_raw_leads.sql.

CREATE OR REPLACE VIEW view_hot_leads AS
WITH base AS (
  SELECT
    r."autoId_ui#",
    r.ID_Individuals,
    r.first_name,
    r.last_name,
    r.email_addr,
    r.phone_nbr,
    r.mobile_phone,
    r.address_1,
    r.city,
    r.state,
    r.zip_code,
    r.occupation_code,
    r.occupation,
    r.CurrentSaleDocumentType,
    r.credit_rating,
    r.home_value,
    r.curr_home_value,
    r.net_worth,
    o.description AS occupation_description,
    d.description AS doc_type_description
  FROM raw_leads r
  LEFT JOIN dict_occupations o ON o.code = r.occupation_code
  LEFT JOIN dict_doc_types   d ON d.code = r.CurrentSaleDocumentType
),
tagged AS (
  SELECT
    base.*,
    (
      -- Wolf Surety
      (base.occupation_description IS NOT NULL AND (
        base.occupation_description ILIKE '%Contractor%'
        OR base.occupation_description ILIKE '%Builder%'
        OR base.occupation_description ILIKE '%Electrician%'
        OR base.occupation_description ILIKE '%Plumber%'
      )) OR
      (base.CurrentSaleDocumentType IN ('77', '34')
        OR base.doc_type_description ILIKE '%Notice of Default%'
        OR base.doc_type_description ILIKE '%Foreclosure%') OR
      -- Dispute LLC
      (base.credit_rating IS NOT NULL AND base.credit_rating <> '' AND (
        base.credit_rating ILIKE '%low%'
        OR base.credit_rating ILIKE '%poor%'
        OR base.credit_rating ILIKE '%fair%'
      )) OR
      base.CurrentSaleDocumentType = '77' OR
      -- Lyco Tax
      (COALESCE(base.home_value, 0) > 1000000 OR COALESCE(base.curr_home_value, 0) > 1000000) OR
      (base.net_worth IS NOT NULL AND (
        (base.net_worth::text ~ '^[0-9.]*$' AND (base.net_worth::numeric >= 1000000)) OR (base.net_worth::text ILIKE '%high%')
      )) OR
      (base.occupation_description IS NOT NULL AND (
        base.occupation_description ILIKE '%Self Employed%'
        OR base.occupation_description ILIKE '%Business Owner%'
      ))
    ) AS is_hot,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN base.occupation_description IS NOT NULL AND (
        base.occupation_description ILIKE '%Contractor%' OR base.occupation_description ILIKE '%Builder%'
        OR base.occupation_description ILIKE '%Electrician%' OR base.occupation_description ILIKE '%Plumber%'
      ) THEN 'Wolf_Trade' END,
      CASE WHEN base.CurrentSaleDocumentType IN ('77', '34')
        OR base.doc_type_description ILIKE '%Notice of Default%'
        OR base.doc_type_description ILIKE '%Foreclosure%' THEN 'Distressed_Property' END,
      CASE WHEN (base.credit_rating IS NOT NULL AND base.credit_rating <> '' AND (
          base.credit_rating ILIKE '%low%' OR base.credit_rating ILIKE '%poor%' OR base.credit_rating ILIKE '%fair%'
        )) OR base.CurrentSaleDocumentType = '77' THEN 'Credit_Repair_Urgent' END,
      CASE WHEN (COALESCE(base.home_value, 0) > 1000000 OR COALESCE(base.curr_home_value, 0) > 1000000)
        OR (base.net_worth IS NOT NULL AND (
          (base.net_worth::text ~ '^[0-9.]*$' AND base.net_worth::numeric >= 1000000) OR (base.net_worth::text ILIKE '%high%')
        )) THEN 'Lyco_HighNetWorth' END,
      CASE WHEN base.occupation_description IS NOT NULL AND (
        base.occupation_description ILIKE '%Self Employed%' OR base.occupation_description ILIKE '%Business Owner%'
      ) THEN 'Lyco_Business' END
    ], NULL) AS tags
  FROM base
)
SELECT
  "autoId_ui#",
  ID_Individuals,
  first_name,
  last_name,
  email_addr,
  phone_nbr,
  mobile_phone,
  address_1,
  city,
  state,
  zip_code,
  occupation_code,
  occupation_description,
  CurrentSaleDocumentType,
  doc_type_description,
  credit_rating,
  home_value,
  curr_home_value,
  net_worth,
  tags
FROM tagged
WHERE is_hot = true;

COMMENT ON VIEW view_hot_leads IS 'Hot leads tagged by Ziarem Intelligence Engine: Wolf_Trade, Distressed_Property, Credit_Repair_Urgent, Lyco_HighNetWorth, Lyco_Business';
