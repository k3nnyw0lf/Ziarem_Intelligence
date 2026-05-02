-- ════════════════════════════════════════════════════════════════════════
-- PARKED — DO NOT APPLY UNTIL ADMIN UI MIGRATED
-- ════════════════════════════════════════════════════════════════════════
--
-- This file deliberately does NOT match the `2026*.sql` glob, so the
-- SQL CI job will not pick it up and `apply_migration` will not see it
-- as a pending migration.
--
-- WHY PARKED
-- ----------
-- public.credentials currently has two RLS policies that pre-date the
-- Hermes work:
--
--   admins_full_access    TO authenticated   USING (true)  WITH CHECK (true)
--   service_role_all      TO PUBLIC          USING (true)  WITH CHECK (true)
--
-- Net effect: any authenticated JWT can `SELECT api_key, api_secret`
-- from every credential, and the polroles={-} on service_role_all
-- means PUBLIC has full access too. Anyone with the anon key can
-- enumerate every API key the Ziarem stack uses.
--
-- The Supabase advisor flagged this as a P1 (`rls_policy_always_true`
-- on `service_role_all`); the `admins_full_access` policy is a P0
-- because authenticated JWTs are common in client code paths.
--
-- WHEN TO APPLY
-- -------------
-- After the admin UI in `lead-manager-crm` is moved to:
--   1. READ from `public.v_credentials_admin` (presence flags only,
--      never the actual key/secret bytes).
--   2. WRITE via a new `SECURITY DEFINER` function (e.g.
--      `public.fn_credentials_set(service_id, api_key, api_secret,
--      base_url, config)`) that the admin UI calls instead of an
--      UPDATE on the table directly.
--
-- Until both halves of the admin UI are migrated, applying this file
-- will break the admin's read AND write paths. This is why it is
-- parked.
--
-- HOW TO APPLY (when ready)
-- -------------------------
-- 1. Verify the admin UI no longer SELECTs from public.credentials
--    directly:
--      SELECT count(*) FROM pg_stat_statements
--      WHERE query ILIKE '%FROM public.credentials%'
--        AND query ILIKE '%api_key%';
--    Should be 0 (or only Hermes service-role calls).
--
-- 2. Verify the admin UI writes via a SECURITY DEFINER function (or
--    grant table-level UPDATE only to a specific role you control).
--
-- 3. Rename this file to `2026MMDDhhmmss_credentials_policy_fix.sql`
--    so it matches the CI glob.
--
-- 4. Apply via `mcp apply_migration` against the live project.
--
-- 5. Re-run `get_advisors security` and confirm both findings on
--    public.credentials are gone.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- Drop the dangerous open policies.
DROP POLICY IF EXISTS admins_full_access ON public.credentials;
DROP POLICY IF EXISTS service_role_all   ON public.credentials;

-- Service-role-only: server-side code (Hermes, omni_sender, edge
-- functions) is the only thing that should ever touch raw key/secret
-- columns.
CREATE POLICY service_role_all ON public.credentials
  AS PERMISSIVE FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Grant authenticated users SELECT on the safe view (presence flags
-- only). The view's SELECT list excludes api_key / api_secret.
GRANT SELECT ON public.v_credentials_admin TO authenticated;

-- Optional: a SECURITY DEFINER function the admin UI can call to set
-- a credential without holding direct UPDATE on the table. Caller
-- must be in `authenticated` role; the function runs as the postgres
-- owner and writes the row.
CREATE OR REPLACE FUNCTION public.fn_credentials_set(
  p_service_name text,
  p_api_key      text,
  p_api_secret   text DEFAULT NULL,
  p_base_url     text DEFAULT NULL,
  p_config       jsonb DEFAULT NULL,
  p_notes        text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  -- Caller must be a logged-in user (Supabase admin UI). Anon role
  -- cannot reach this function because EXECUTE is GRANTed only to
  -- authenticated below.
  IF auth.role() IS NULL OR auth.role() = 'anon' THEN
    RAISE EXCEPTION 'fn_credentials_set requires authenticated context';
  END IF;

  INSERT INTO public.credentials
    (service_name, api_key, api_secret, base_url, config, notes)
  VALUES
    (p_service_name, p_api_key, p_api_secret, p_base_url, p_config, p_notes)
  ON CONFLICT (service_name) DO UPDATE
    SET api_key    = COALESCE(EXCLUDED.api_key,    public.credentials.api_key),
        api_secret = COALESCE(EXCLUDED.api_secret, public.credentials.api_secret),
        base_url   = COALESCE(EXCLUDED.base_url,   public.credentials.base_url),
        config     = COALESCE(EXCLUDED.config,     public.credentials.config),
        notes      = COALESCE(EXCLUDED.notes,      public.credentials.notes),
        updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION
  public.fn_credentials_set(text, text, text, text, jsonb, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION
  public.fn_credentials_set(text, text, text, text, jsonb, text) TO authenticated;

COMMENT ON FUNCTION public.fn_credentials_set(text, text, text, text, jsonb, text) IS
  'Admin-UI write path for public.credentials. SECURITY DEFINER so the caller does not need direct UPDATE. Idempotent on service_name (UPSERT). Does NOT log secrets.';

COMMIT;

-- ════════════════════════════════════════════════════════════════════════
-- Verification (run after applying):
--   SELECT polname, polroles::regrole[] FROM pg_policy
--    WHERE polrelid = 'public.credentials'::regclass;
--   -> should show only `service_role_all` TO service_role
--
--   SELECT has_function_privilege('authenticated',
--     'public.fn_credentials_set(text,text,text,text,jsonb,text)', 'EXECUTE');
--   -> true
--
--   SELECT has_table_privilege('authenticated', 'public.credentials', 'SELECT');
--   -> false  (admin UI now reads via v_credentials_admin)
-- ════════════════════════════════════════════════════════════════════════
