-- Cross-sell auto-detection function.
--
-- Run on a schedule (Supabase pg_cron daily) or manually via:
--   SELECT * FROM public.fn_detect_dm_cross_sells();
--
-- Idempotent: NOT EXISTS guards prevent duplicate cross_sell_opportunities
-- rows for the same (client_id, missing_lobs).
--
-- Strict matching: dm_loans → clients via lower(email) ONLY. If a DM loan
-- has no email match (or multiple matches, ambiguous), the function skips it.
-- Operator can manually backfill the cross-sell row.

-- Defensive stubs so CI's fresh-Postgres job can compile this file without
-- the legacy migrations. Production already has the real tables, so the
-- IF NOT EXISTS clauses are no-ops.
CREATE TABLE IF NOT EXISTS public.clients (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  phone text
);
CREATE TABLE IF NOT EXISTS public.dm_loans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id             text,
  borrower_name       text,
  client_email        text,
  loan_status         text,
  loan_amount         numeric,
  closing_date        date,
  property_address    text,
  hoi_policy_number   text,
  ws_policy_id        text,
  title_order_number  text
);
CREATE TABLE IF NOT EXISTS public.cross_sell_opportunities (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                uuid,
  client_name              text,
  current_lobs             text[],
  missing_lobs             text[],
  estimated_annual_premium numeric,
  estimated_commission     numeric,
  priority                 int,
  status                   text DEFAULT 'identified',
  auto_detected            boolean DEFAULT false,
  detection_reason         text,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.fn_detect_dm_cross_sells()
RETURNS TABLE (
  inserted_id uuid,
  dm_loan_id  text,
  client_id   uuid,
  missing_lob text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  -- Stage A: DM loans missing HOI in the next 60 days → Wolf Surety cross-sell
  RETURN QUERY
  WITH candidate AS (
    SELECT
      dm.id          AS dm_uuid,
      dm.loan_id,
      dm.borrower_name,
      dm.loan_amount,
      dm.closing_date,
      dm.property_address,
      (SELECT id FROM clients
        WHERE lower(email) = lower(dm.client_email)
        LIMIT 2) AS client_id_candidate,
      (SELECT count(*) FROM clients
        WHERE lower(email) = lower(dm.client_email)) AS client_match_count
    FROM dm_loans dm
    WHERE NULLIF(dm.client_email,'') IS NOT NULL
      AND lower(dm.loan_status) IN ('processing','underwriting','clear_to_close','ctc','approved')
      AND NULLIF(dm.hoi_policy_number,'') IS NULL
      AND dm.ws_policy_id IS NULL
      AND dm.closing_date BETWEEN now()::date AND (now() + interval '60 days')::date
  ),
  inserts AS (
    INSERT INTO cross_sell_opportunities
      (client_id, client_name, current_lobs, missing_lobs,
       estimated_annual_premium, estimated_commission,
       priority, status, auto_detected, detection_reason)
    SELECT
      c.client_id_candidate,
      c.borrower_name,
      ARRAY['mortgage']::text[],
      ARRAY['homeowners_ins']::text[],
      2400.0,
      600.0,
      8,
      'identified', true,
      'fn_detect_dm_cross_sells: dm_loan ' || c.loan_id ||
      ' closing ' || c.closing_date::text || ' missing HOI'
    FROM candidate c
    WHERE c.client_match_count = 1
      AND NOT EXISTS (
        SELECT 1 FROM cross_sell_opportunities cs
        WHERE cs.client_id = c.client_id_candidate
          AND ARRAY['homeowners_ins'] && cs.missing_lobs)
    RETURNING id, client_id
  )
  SELECT i.id, c.loan_id, i.client_id, 'homeowners_ins'::text
  FROM inserts i
  JOIN candidate c ON c.client_id_candidate = i.client_id;

  -- Stage B: DM loans missing title in the next 60 days → CBW cross-sell
  RETURN QUERY
  WITH candidate AS (
    SELECT
      dm.id          AS dm_uuid,
      dm.loan_id,
      dm.borrower_name,
      dm.loan_amount,
      dm.closing_date,
      dm.property_address,
      (SELECT id FROM clients
        WHERE lower(email) = lower(dm.client_email)
        LIMIT 2) AS client_id_candidate,
      (SELECT count(*) FROM clients
        WHERE lower(email) = lower(dm.client_email)) AS client_match_count
    FROM dm_loans dm
    WHERE NULLIF(dm.client_email,'') IS NOT NULL
      AND lower(dm.loan_status) IN ('processing','underwriting','clear_to_close','ctc','approved')
      AND NULLIF(dm.title_order_number,'') IS NULL
      AND dm.closing_date BETWEEN now()::date AND (now() + interval '60 days')::date
  ),
  inserts AS (
    INSERT INTO cross_sell_opportunities
      (client_id, client_name, current_lobs, missing_lobs,
       estimated_annual_premium, estimated_commission,
       priority, status, auto_detected, detection_reason)
    SELECT
      c.client_id_candidate,
      c.borrower_name,
      ARRAY['mortgage']::text[],
      ARRAY['title_settlement']::text[],
      500.0,
      1500.0,
      7,
      'identified', true,
      'fn_detect_dm_cross_sells: dm_loan ' || c.loan_id ||
      ' closing ' || c.closing_date::text || ' missing title'
    FROM candidate c
    WHERE c.client_match_count = 1
      AND NOT EXISTS (
        SELECT 1 FROM cross_sell_opportunities cs
        WHERE cs.client_id = c.client_id_candidate
          AND ARRAY['title_settlement'] && cs.missing_lobs)
    RETURNING id, client_id
  )
  SELECT i.id, c.loan_id, i.client_id, 'title_settlement'::text
  FROM inserts i
  JOIN candidate c ON c.client_id_candidate = i.client_id;
END;
$fn$;

COMMENT ON FUNCTION public.fn_detect_dm_cross_sells() IS
  'Detects DM loans that are missing HOI or title and inserts cross_sell_opportunities rows. Idempotent (NOT EXISTS). Strict email-only client lookup; ambiguous matches are skipped.';

-- Grant execute to service_role only (Hermes calls via service-role JWT).
REVOKE EXECUTE ON FUNCTION public.fn_detect_dm_cross_sells() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_detect_dm_cross_sells() TO service_role;

-- ────────────────────────────────────────────────────────────────────────
-- Convenience view: what would the next run insert? (Operator dry-run.)
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_dm_cross_sell_candidates AS
WITH candidate AS (
  SELECT
    dm.loan_id,
    dm.borrower_name,
    dm.client_email,
    dm.loan_amount,
    dm.closing_date,
    dm.property_address,
    (SELECT count(*) FROM clients
      WHERE lower(email) = lower(dm.client_email)) AS client_match_count
  FROM dm_loans dm
  WHERE NULLIF(dm.client_email,'') IS NOT NULL
    AND lower(dm.loan_status) IN ('processing','underwriting','clear_to_close','ctc','approved')
    AND dm.closing_date BETWEEN now()::date AND (now() + interval '60 days')::date
)
SELECT
  loan_id, borrower_name, client_email, loan_amount, closing_date,
  property_address,
  CASE
    WHEN client_match_count = 0 THEN 'no_client_match'
    WHEN client_match_count > 1 THEN 'ambiguous_match'
    ELSE 'ready'
  END AS match_state,
  client_match_count
FROM candidate;

ALTER VIEW public.v_dm_cross_sell_candidates SET (security_invoker = on);
COMMENT ON VIEW public.v_dm_cross_sell_candidates IS
  'Read-only preview of what fn_detect_dm_cross_sells would consider next.';
