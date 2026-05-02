-- Vault-side cross-sell detector (parallel to fn_detect_dm_cross_sells)
-- + pg_cron schedule for both detectors so the pipeline fills itself
-- without operator intervention.

-- ────────────────────────────────────────────────────────────────────────
-- 1. fn_detect_vault_cross_sells — Vault-side equivalent of the DM detector
-- ────────────────────────────────────────────────────────────────────────

-- Defensive stubs so CI's fresh-Postgres job can compile this file. On
-- production, vault_loans + ws_policies + cross_sell_opportunities all
-- already exist with these columns; the IF NOT EXISTS clauses are no-op.
CREATE TABLE IF NOT EXISTS public.vault_loans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text,
  phone               text,
  first_name          text,
  last_name           text,
  loan_amount         numeric,
  closing_date        date,
  property_address    text,
  stage               text,
  service_type        text,
  business            text,
  insurance_status    text,
  ws_policy_id_link   text,
  cross_sell_from     uuid
);

CREATE OR REPLACE FUNCTION public.fn_detect_vault_cross_sells()
RETURNS TABLE (
  inserted_id uuid,
  vault_id    uuid,
  client_id   uuid,
  missing_lob text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  -- Vault loans missing insurance handoff in next 60 days → Wolf cross-sell
  RETURN QUERY
  WITH candidate AS (
    SELECT
      v.id              AS vault_id,
      v.first_name || ' ' || COALESCE(v.last_name,'') AS borrower_name,
      v.loan_amount,
      v.closing_date,
      v.property_address,
      (SELECT id FROM clients WHERE lower(email) = lower(v.email) LIMIT 2)
                        AS client_id_candidate,
      (SELECT count(*) FROM clients WHERE lower(email) = lower(v.email))
                        AS client_match_count
    FROM vault_loans v
    WHERE NULLIF(v.email,'') IS NOT NULL
      -- Active mortgage stages
      AND v.service_type ILIKE '%mortgage%'
      AND COALESCE(v.stage,'') NOT IN ('declined','withdrawn','funded','closed','cancelled')
      AND v.insurance_status IS NULL
      AND v.ws_policy_id_link IS NULL
      AND v.closing_date BETWEEN now()::date AND (now() + interval '60 days')::date
      -- Don't loop: skip vault rows that themselves came from a cross-sell
      AND v.cross_sell_from IS NULL
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
      'fn_detect_vault_cross_sells: vault_loan ' || c.vault_id::text ||
      ' closing ' || c.closing_date::text || ' missing HOI'
    FROM candidate c
    WHERE c.client_match_count = 1
      AND NOT EXISTS (
        SELECT 1 FROM cross_sell_opportunities cs
        WHERE cs.client_id = c.client_id_candidate
          AND ARRAY['homeowners_ins'] && cs.missing_lobs)
    RETURNING id, client_id
  )
  SELECT i.id, c.vault_id, i.client_id, 'homeowners_ins'::text
  FROM inserts i
  JOIN candidate c ON c.client_id_candidate = i.client_id;
END;
$fn$;

COMMENT ON FUNCTION public.fn_detect_vault_cross_sells() IS
  'Detects vault_loans (mortgage service_type) missing insurance handoff and inserts cross_sell_opportunities. Idempotent. Strict email-only client lookup; ambiguous matches skipped. Skips vault rows that themselves came from a prior cross-sell to prevent loops.';

REVOKE EXECUTE ON FUNCTION public.fn_detect_vault_cross_sells() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_detect_vault_cross_sells() TO service_role;

-- ────────────────────────────────────────────────────────────────────────
-- 2. pg_cron schedules
-- ────────────────────────────────────────────────────────────────────────
-- Idempotent: unschedule first if it exists, then schedule fresh. The
-- DO block guards against the function not existing on a fresh CI DB
-- (where pg_cron extension isn't installed).

DO $cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping cross-sell schedules. '
                 'On Supabase production this extension is enabled by default.';
    RETURN;
  END IF;

  -- DM cross-sell detector — every day at 6:30 AM (offset from existing
  -- cbw-ofac-daily-refresh at 06:00 to avoid collision)
  PERFORM cron.unschedule('hermes-dm-cross-sell-daily')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hermes-dm-cross-sell-daily');
  PERFORM cron.schedule(
    'hermes-dm-cross-sell-daily',
    '30 6 * * *',
    'SELECT public.fn_detect_dm_cross_sells();'
  );

  -- Vault cross-sell detector — same schedule, 1-minute offset
  PERFORM cron.unschedule('hermes-vault-cross-sell-daily')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hermes-vault-cross-sell-daily');
  PERFORM cron.schedule(
    'hermes-vault-cross-sell-daily',
    '31 6 * * *',
    'SELECT public.fn_detect_vault_cross_sells();'
  );
END
$cron$;
