-- Lock down RLS on Hermes-managed tables and views.
--
-- P0 findings from Supabase advisor on the previous two migrations:
--   * crawl4ai_sources, mem0_identity_aliases, mem0_identity_unmerges,
--     skyvern_jobs   — RLS not enabled (data is public to anon JWT)
--   * v_customer_identities, v_credentials_admin
--                    — created as SECURITY DEFINER (bypass caller RLS)
--   * tg_crawl4ai_sources_touch_updated_at
--                    — trigger function with mutable search_path
--
-- Fix: enable RLS on every table, add a service-role-only policy,
-- recreate the views with WITH (security_invoker = on), pin the
-- trigger function's search_path.
--
-- These tables are Hermes/agent-fleet internal state. Only server-side
-- code (service_role JWT) should ever touch them. anon and
-- authenticated JWTs should see nothing.

-- ─── 1. Enable RLS + service-role policy on each table ────────────────────

ALTER TABLE public.crawl4ai_sources       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mem0_identity_aliases  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mem0_identity_unmerges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skyvern_jobs           ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all ON public.crawl4ai_sources;
CREATE POLICY service_role_all ON public.crawl4ai_sources
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all ON public.mem0_identity_aliases;
CREATE POLICY service_role_all ON public.mem0_identity_aliases
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all ON public.mem0_identity_unmerges;
CREATE POLICY service_role_all ON public.mem0_identity_unmerges
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all ON public.skyvern_jobs;
CREATE POLICY service_role_all ON public.skyvern_jobs
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── 2. Re-create views with security_invoker = on ────────────────────────
-- Views default to SECURITY DEFINER on Postgres ≥15. We want INVOKER
-- so RLS on the underlying tables applies to whoever calls the view.

ALTER VIEW public.v_customer_identities SET (security_invoker = on);
ALTER VIEW public.v_credentials_admin   SET (security_invoker = on);

-- ─── 3. Pin trigger function search_path (CVE-class hardening) ────────────

CREATE OR REPLACE FUNCTION public.tg_crawl4ai_sources_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $tg$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$tg$;

-- ─── 4. Document the policy intent on the table comments ─────────────────

COMMENT ON TABLE public.crawl4ai_sources IS
  'Hermes Crawl4AI source registry. RLS: service_role only. Operators read via the admin UI (server-side, service_role JWT).';
COMMENT ON TABLE public.mem0_identity_aliases IS
  'Mem0 UNION-FIND identity merges. RLS: service_role only. Identity data is sensitive — anon/authenticated must never read.';
COMMENT ON TABLE public.mem0_identity_unmerges IS
  'Audit log of un-merges. Append-only. RLS: service_role only.';
COMMENT ON TABLE public.skyvern_jobs IS
  'Skyvern dispatch queue. RLS: service_role only. NOT to be confused with public.ws_outbound_queue (Wolf Surety voice-call queue).';
