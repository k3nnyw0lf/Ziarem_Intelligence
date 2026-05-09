-- ============================================================================
-- Ziarem AI Inbox Engine
-- Adds AI triage, historical backfill, KB (Laenan/DOS/etc.), CRM auto-update.
-- Additive only — safe to run on a live database.
-- ============================================================================

-- pgvector is optional; falls back to JSONB if unavailable.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    BEGIN
      CREATE EXTENSION vector;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pgvector not available — embeddings will use JSONB fallback';
    END;
  END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- Extend business_emails with sync state + scoping flags
-- ============================================================================

ALTER TABLE business_emails ADD COLUMN IF NOT EXISTS business_tag VARCHAR(50);
ALTER TABLE business_emails ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE business_emails ADD COLUMN IF NOT EXISTS imap_port INTEGER NOT NULL DEFAULT 993;
ALTER TABLE business_emails ADD COLUMN IF NOT EXISTS smtp_port INTEGER NOT NULL DEFAULT 587;
ALTER TABLE business_emails ADD COLUMN IF NOT EXISTS daily_pull_limit INTEGER NOT NULL DEFAULT 5000;
ALTER TABLE business_emails ADD COLUMN IF NOT EXISTS last_imap_sync_at TIMESTAMPTZ;
ALTER TABLE business_emails ADD COLUMN IF NOT EXISTS last_uid_seen BIGINT;
ALTER TABLE business_emails ADD COLUMN IF NOT EXISTS backfill_started_at TIMESTAMPTZ;
ALTER TABLE business_emails ADD COLUMN IF NOT EXISTS backfill_completed_at TIMESTAMPTZ;
ALTER TABLE business_emails ADD COLUMN IF NOT EXISTS backfill_through_date DATE;
ALTER TABLE business_emails ADD COLUMN IF NOT EXISTS last_sync_error TEXT;

CREATE INDEX IF NOT EXISTS idx_business_emails_active ON business_emails (is_active);
CREATE INDEX IF NOT EXISTS idx_business_emails_tag ON business_emails (business_tag);

-- ============================================================================
-- Extend communications with full email metadata + AI fields
-- ============================================================================

ALTER TABLE communications ADD COLUMN IF NOT EXISTS rfc822_message_id TEXT;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS in_reply_to TEXT;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS message_refs TEXT[];
ALTER TABLE communications ADD COLUMN IF NOT EXISTS thread_key TEXT;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS from_addr TEXT;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS from_name TEXT;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS to_addrs TEXT[];
ALTER TABLE communications ADD COLUMN IF NOT EXISTS cc_addrs TEXT[];
ALTER TABLE communications ADD COLUMN IF NOT EXISTS imap_uid BIGINT;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS raw_eml_key TEXT;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS size_bytes INTEGER;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS has_attachments BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE communications ADD COLUMN IF NOT EXISTS ai_processed_at TIMESTAMPTZ;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS ai_summary TEXT;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS ai_intent VARCHAR(50);
ALTER TABLE communications ADD COLUMN IF NOT EXISTS ai_priority SMALLINT;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS ai_tags TEXT[];
ALTER TABLE communications ADD COLUMN IF NOT EXISTS ai_extracted JSONB;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS ai_business_tag VARCHAR(50);
ALTER TABLE communications ADD COLUMN IF NOT EXISTS ai_lead_match_confidence SMALLINT;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS ai_lead_match_hints JSONB;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS ai_score_delta INTEGER;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS ai_error TEXT;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS ai_attempts SMALLINT NOT NULL DEFAULT 0;

-- Embedding column: vector(768) if pgvector available, else jsonb
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    EXECUTE 'ALTER TABLE communications ADD COLUMN IF NOT EXISTS embedding vector(768)';
  ELSE
    EXECUTE 'ALTER TABLE communications ADD COLUMN IF NOT EXISTS embedding JSONB';
  END IF;
END $$;

-- Full-text search column (generated)
ALTER TABLE communications
  ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(subject, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(left(body_text, 100000), '')), 'B')
  ) STORED;

-- Idempotency: dedupe by (business_id, rfc822_message_id) where message id present,
-- and by (business_id, imap_uid) as a fallback. Both indexes are partial.
CREATE UNIQUE INDEX IF NOT EXISTS uq_comm_business_rfc
  ON communications (business_id, rfc822_message_id)
  WHERE rfc822_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_comm_business_uid
  ON communications (business_id, imap_uid)
  WHERE imap_uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_comm_thread_key ON communications (thread_key) WHERE thread_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comm_from_addr ON communications (from_addr) WHERE from_addr IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comm_ai_unprocessed ON communications (id) WHERE ai_processed_at IS NULL AND direction = 'INBOUND';
CREATE INDEX IF NOT EXISTS idx_comm_fts ON communications USING gin (fts);
CREATE INDEX IF NOT EXISTS idx_comm_business_sent ON communications (business_id, sent_at DESC);

-- pgvector HNSW if available
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
  AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_comm_embedding') THEN
    EXECUTE 'CREATE INDEX idx_comm_embedding ON communications USING hnsw ((embedding::vector(768)) vector_cosine_ops)';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not create HNSW index: %', SQLERRM;
END $$;

-- ============================================================================
-- email_attachments — refs to S3-style storage (Synology / Hostinger volume)
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_attachments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comm_id     INTEGER NOT NULL REFERENCES communications(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  content_type TEXT,
  size_bytes  INTEGER,
  sha256      TEXT,
  storage_key TEXT NOT NULL,
  is_inline   BOOLEAN NOT NULL DEFAULT FALSE,
  is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  ai_classified VARCHAR(50),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_attachments_comm ON email_attachments (comm_id);
CREATE INDEX IF NOT EXISTS idx_email_attachments_sha ON email_attachments (sha256);

-- ============================================================================
-- Lender knowledge base — Laenan, DOS, others
-- ============================================================================

CREATE TABLE IF NOT EXISTS lender_kb_lenders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         VARCHAR(50) UNIQUE NOT NULL,
  name         VARCHAR(255) NOT NULL,
  domain       VARCHAR(255),
  contact_name VARCHAR(255),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  notes_md     TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lender_kb_products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lender_id       UUID NOT NULL REFERENCES lender_kb_lenders(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  product_type    VARCHAR(50) NOT NULL,  -- conventional|fha|va|usda|jumbo|dscr|bank_statement|...
  rate_min        NUMERIC(6,4),
  rate_max        NUMERIC(6,4),
  apr_min         NUMERIC(6,4),
  ltv_max         NUMERIC(5,2),
  fico_min        INTEGER,
  dti_max         NUMERIC(5,2),
  loan_amount_min NUMERIC(14,2),
  loan_amount_max NUMERIC(14,2),
  occupancy       TEXT[],
  property_types  TEXT[],
  states_allowed  TEXT[],
  requirements_md TEXT,
  notes_md        TEXT,
  source_doc_key  TEXT,
  effective_from  DATE,
  effective_to    DATE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    EXECUTE 'ALTER TABLE lender_kb_products ADD COLUMN IF NOT EXISTS embedding vector(768)';
  ELSE
    EXECUTE 'ALTER TABLE lender_kb_products ADD COLUMN IF NOT EXISTS embedding JSONB';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_lender_products_lender ON lender_kb_products (lender_id);
CREATE INDEX IF NOT EXISTS idx_lender_products_type ON lender_kb_products (product_type);
CREATE INDEX IF NOT EXISTS idx_lender_products_name_trgm ON lender_kb_products USING gin (name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS lender_kb_scenarios (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title          VARCHAR(255) NOT NULL,
  description_md TEXT,
  criteria       JSONB NOT NULL,
  recommended_product_ids UUID[] NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- crm_activities + lead_score_events — CRM auto-update from emails
-- ============================================================================

CREATE TABLE IF NOT EXISTS crm_activities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     BIGINT REFERENCES leads(autoId_ui) ON DELETE SET NULL,
  business_id INTEGER REFERENCES business_emails(id) ON DELETE SET NULL,
  comm_id     INTEGER REFERENCES communications(id) ON DELETE SET NULL,
  type        VARCHAR(50) NOT NULL,   -- email_in | email_out | doc_received | quote_request | ...
  subject     TEXT,
  body        TEXT,
  ai_insight  TEXT,
  outcome     TEXT,
  next_action TEXT,
  next_action_due DATE,
  completed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_activities_lead ON crm_activities (lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_business ON crm_activities (business_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_created ON crm_activities (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_activities_type ON crm_activities (type);

CREATE TABLE IF NOT EXISTS lead_score_events (
  id          BIGSERIAL PRIMARY KEY,
  lead_id     BIGINT NOT NULL REFERENCES leads(autoId_ui) ON DELETE CASCADE,
  event_type  VARCHAR(50) NOT NULL,
  score_delta INTEGER NOT NULL,
  reason      TEXT,
  ai_insight  TEXT,
  comm_id     INTEGER REFERENCES communications(id) ON DELETE SET NULL,
  business_id INTEGER REFERENCES business_emails(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_score_events_lead ON lead_score_events (lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_score_events_created ON lead_score_events (created_at DESC);

-- Add a denormalized score column on leads for fast read (recomputed by trigger or job).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS touch_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_leads_score ON leads (lead_score DESC) WHERE lead_score > 0;
CREATE INDEX IF NOT EXISTS idx_leads_last_contacted ON leads (last_contacted_at DESC) WHERE last_contacted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads (LOWER(TRIM(email_addr))) WHERE email_addr IS NOT NULL;

-- ============================================================================
-- Inbox threads view — synthesizes a thread per (business, thread_key)
-- ============================================================================

CREATE OR REPLACE VIEW v_inbox_threads AS
SELECT
  COALESCE(c.thread_key, c.rfc822_message_id, 'comm-' || c.id::text) AS thread_id,
  c.business_id,
  be.business_name,
  be.business_tag,
  c.lead_id,
  l.first_name || ' ' || l.last_name AS lead_name,
  l.email_addr AS lead_email,
  MAX(c.subject)             AS subject,
  COUNT(*)                   AS message_count,
  COUNT(*) FILTER (WHERE NOT c.is_read AND c.direction = 'INBOUND') AS unread_count,
  MAX(c.sent_at)             AS last_message_at,
  MIN(c.sent_at)             AS first_message_at,
  MAX(c.ai_priority)         AS max_priority,
  ARRAY_AGG(DISTINCT c.ai_intent) FILTER (WHERE c.ai_intent IS NOT NULL) AS intents,
  ARRAY_AGG(DISTINCT t) FILTER (WHERE t IS NOT NULL) AS tags
FROM communications c
LEFT JOIN business_emails be ON be.id = c.business_id
LEFT JOIN leads l ON l.autoId_ui = c.lead_id
LEFT JOIN LATERAL unnest(c.ai_tags) t ON TRUE
GROUP BY thread_id, c.business_id, be.business_name, be.business_tag, c.lead_id, l.first_name, l.last_name, l.email_addr;

-- ============================================================================
-- Function: hybrid search across communications (FTS + embedding cosine)
-- ============================================================================

CREATE OR REPLACE FUNCTION search_communications_hybrid(
  p_query TEXT,
  p_query_embedding JSONB DEFAULT NULL,
  p_business_ids INTEGER[] DEFAULT NULL,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  comm_id INTEGER,
  subject TEXT,
  snippet TEXT,
  sent_at TIMESTAMPTZ,
  business_id INTEGER,
  lead_id BIGINT,
  rank REAL
)
LANGUAGE sql STABLE AS $$
  WITH fts AS (
    SELECT c.id AS comm_id, c.subject, LEFT(c.body_text, 240) AS snippet, c.sent_at, c.business_id, c.lead_id,
           ts_rank_cd(c.fts, websearch_to_tsquery('english', p_query)) AS r
    FROM communications c
    WHERE c.fts @@ websearch_to_tsquery('english', p_query)
      AND (p_business_ids IS NULL OR c.business_id = ANY(p_business_ids))
    ORDER BY r DESC
    LIMIT p_limit * 2
  )
  SELECT comm_id, subject, snippet, sent_at, business_id, lead_id, r::real AS rank
  FROM fts
  ORDER BY rank DESC
  LIMIT p_limit;
$$;

-- ============================================================================
-- Trigger: auto-touch leads on new INBOUND communication
-- ============================================================================

CREATE OR REPLACE FUNCTION touch_lead_on_communication() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL AND NEW.direction = 'INBOUND' THEN
    UPDATE leads
    SET last_contacted_at = NEW.sent_at,
        touch_count = touch_count + 1
    WHERE autoId_ui = NEW.lead_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_lead_on_communication ON communications;
CREATE TRIGGER trg_touch_lead_on_communication
  AFTER INSERT ON communications
  FOR EACH ROW EXECUTE FUNCTION touch_lead_on_communication();

-- ============================================================================
-- Trigger: maintain leads.lead_score from lead_score_events
-- ============================================================================

CREATE OR REPLACE FUNCTION apply_lead_score_event() RETURNS TRIGGER AS $$
BEGIN
  UPDATE leads SET lead_score = COALESCE(lead_score, 0) + NEW.score_delta
   WHERE autoId_ui = NEW.lead_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_apply_lead_score_event ON lead_score_events;
CREATE TRIGGER trg_apply_lead_score_event
  AFTER INSERT ON lead_score_events
  FOR EACH ROW EXECUTE FUNCTION apply_lead_score_event();

-- ============================================================================
-- Seed lender_kb_lenders for Laenan + DOS Mortgage
-- ============================================================================

INSERT INTO lender_kb_lenders (slug, name, domain, is_active) VALUES
  ('laenan', 'Laenan', 'laenan.com', TRUE),
  ('dosmortgage', 'DOS Mortgage', 'dosmortgage.com', TRUE)
ON CONFLICT (slug) DO NOTHING;

COMMENT ON TABLE lender_kb_lenders IS 'Knowledge base of lenders Ziarem submits scenarios to (Laenan, DOS, etc.)';
COMMENT ON TABLE lender_kb_products IS 'Loan products with rates / requirements; AI uses these for client-fit recommendations.';
COMMENT ON TABLE crm_activities IS 'Per-lead CRM timeline; auto-populated from inbound emails by ai_worker.js';
COMMENT ON TABLE lead_score_events IS 'Score deltas from interactions; trigger keeps leads.lead_score in sync';
COMMENT ON COLUMN business_emails.is_active IS 'Only is_active=TRUE businesses are pulled by imap_sync / backfill';
COMMENT ON COLUMN communications.ai_processed_at IS 'NULL = needs triage; ai_worker.js picks these up';
