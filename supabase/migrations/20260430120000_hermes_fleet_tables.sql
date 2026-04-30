-- Hermes agent fleet — helper tables and views.
--
-- These back the agents under hermes/agents/ (Skyvern, Crawl4AI, Mem0):
--   * crawl4ai_sources         — feed URLs for the research crawler
--   * mem0_identity_aliases    — UNION-FIND identity merging across surfaces
--   * v_customer_identities    — read-only view that maps every surface
--                                 (lead/email/wa/tg/slack) to one Mem0 user_id
--
-- Idempotent: safe to re-run.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- Crawl4AI source registry (referenced by hermes/agents/crawl4ai/README.md
-- and hermes/skills/crawl4ai-fanout/SKILL.md).
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crawl4ai_sources (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  url           text NOT NULL,
  cadence       text NOT NULL CHECK (cadence IN ('hourly','daily','weekly','monthly')),
  target_table  text NOT NULL,
  target_app    text NOT NULL,                       -- prefix from hermes/apps.yaml
  extract_hint  text,                                -- LLM steering for relevance
  active        boolean NOT NULL DEFAULT true,
  last_run_at   timestamptz,
  last_status   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, url)
);

CREATE INDEX IF NOT EXISTS idx_crawl4ai_sources_due
  ON public.crawl4ai_sources (active, last_run_at)
  WHERE active = true;

-- ────────────────────────────────────────────────────────────────────────────
-- Mem0 identity alias table (UNION-FIND across surfaces).
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mem0_identity_aliases (
  primary_id   text NOT NULL,
  alias_id     text NOT NULL,
  confidence   numeric NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  source       text,                                 -- 'phone_match' | 'email_match' | 'manual' | ...
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (primary_id, alias_id)
);

CREATE INDEX IF NOT EXISTS idx_mem0_alias_alias_id
  ON public.mem0_identity_aliases (alias_id);

-- ────────────────────────────────────────────────────────────────────────────
-- v_customer_identities — read-only view exposing every surface's Mem0
-- user_id. Hermes resolves any incoming surface to a single user_id by
-- looking up here, then merging via mem0_identity_aliases.
--
-- Defensive: builds a UNION ALL only over the source tables that exist
-- in this deploy. Lets the migration apply against:
--   * a fresh CI Postgres (no legs → empty stub view)
--   * a partial Supabase project (one leg)
--   * the real Ziarem Supabase (all legs)
-- without referencing tables that haven't been created yet.
-- ────────────────────────────────────────────────────────────────────────────
DO $migration$
DECLARE
  legs   text[] := ARRAY[]::text[];
  vw_sql text;
BEGIN
  IF to_regclass('public.leads') IS NOT NULL THEN
    legs := array_append(legs, $sql$
      SELECT 'lead:' || id::text AS mem0_user_id,
             'lead'              AS surface,
             id::text             AS surface_id,
             NULL::text           AS display_hint
      FROM public.leads
    $sql$);
  END IF;

  IF to_regclass('public.vault_telegram_config') IS NOT NULL THEN
    legs := array_append(legs, $sql$
      SELECT 'tg:' || chat_id::text AS mem0_user_id,
             'telegram'             AS surface,
             chat_id::text          AS surface_id,
             NULL::text             AS display_hint
      FROM public.vault_telegram_config
      WHERE chat_id IS NOT NULL
    $sql$);
  END IF;

  IF cardinality(legs) > 0 THEN
    vw_sql := 'CREATE OR REPLACE VIEW public.v_customer_identities AS ' ||
              array_to_string(legs, ' UNION ALL ');
  ELSE
    -- Stub view: same column shape, never returns rows. Lets downstream
    -- code reference the view safely on a fresh DB.
    vw_sql := $stub$
      CREATE OR REPLACE VIEW public.v_customer_identities AS
      SELECT NULL::text AS mem0_user_id,
             NULL::text AS surface,
             NULL::text AS surface_id,
             NULL::text AS display_hint
      WHERE false
    $stub$;
  END IF;

  EXECUTE vw_sql;
END
$migration$;

COMMENT ON VIEW public.v_customer_identities IS
  'Hermes/Mem0 identity map. Built dynamically over whichever source tables exist; extend the DO block when a new surface table lands.';

-- ────────────────────────────────────────────────────────────────────────────
-- ws_outbound_queue is referenced by every Wolf Insurance Skyvern
-- workflow. Create it if it doesn't already exist (some deployments
-- already have it).
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ws_outbound_queue (
  id              serial PRIMARY KEY,
  kind            text NOT NULL,                     -- 'quote_pull' | 'bind_submit' | ...
  status          text NOT NULL DEFAULT 'Pending'
                  CHECK (status IN ('Pending','Sent','Failed','Cancelled')),
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts        int NOT NULL DEFAULT 0,
  result_id       int,
  error_message   text,
  scheduled_for   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ws_queue_pending
  ON public.ws_outbound_queue (kind, scheduled_for)
  WHERE status = 'Pending';

COMMIT;
