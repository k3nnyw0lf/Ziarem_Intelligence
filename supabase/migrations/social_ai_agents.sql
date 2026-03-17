-- =============================================================
-- Social AI Agent Module — Supabase Migration
-- =============================================================
-- Tables: vault_social_brands, vault_social_connections,
--         vault_social_agent_config, vault_social_api_keys,
--         vault_social_posts, vault_social_generation_logs
-- =============================================================

-- -----------------------------------------------------------
-- 0. Helper: reusable updated_at trigger function
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION vault_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------
-- 1. vault_social_brands
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_social_brands (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text        NOT NULL,
  slug                  text        UNIQUE NOT NULL,
  primary_business_type text        NOT NULL DEFAULT 'OTHER',
  logo_url              text,
  default_language_mix  jsonb       DEFAULT '{"en": 0.7, "es": 0.3}',
  daily_video_limit     int         DEFAULT 3,
  daily_post_limit      int         DEFAULT 10,
  critique_mode_enabled boolean     DEFAULT false,
  timezone              text        DEFAULT 'America/New_York',
  is_active             boolean     DEFAULT true,
  owner_id              uuid        REFERENCES auth.users,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),

  CONSTRAINT chk_business_type CHECK (
    primary_business_type IN ('INSURANCE','REAL_ESTATE','TITLE','CREDIT','TAX','OTHER')
  )
);

CREATE TRIGGER trg_social_brands_updated_at
  BEFORE UPDATE ON vault_social_brands
  FOR EACH ROW EXECUTE FUNCTION vault_set_updated_at();

-- -----------------------------------------------------------
-- 2. vault_social_connections
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_social_connections (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id             uuid        NOT NULL REFERENCES vault_social_brands(id) ON DELETE CASCADE,
  platform             text        NOT NULL,
  account_handle       text,
  eclincher_profile_id text,
  is_active            boolean     DEFAULT true,
  created_at           timestamptz DEFAULT now(),

  CONSTRAINT chk_platform CHECK (
    platform IN ('INSTAGRAM','TIKTOK','YOUTUBE','LINKEDIN','FACEBOOK','X')
  )
);

CREATE INDEX idx_social_connections_brand_id  ON vault_social_connections(brand_id);
CREATE INDEX idx_social_connections_platform  ON vault_social_connections(platform);

-- -----------------------------------------------------------
-- 3. vault_social_agent_config
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_social_agent_config (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id            uuid        NOT NULL REFERENCES vault_social_brands(id) ON DELETE CASCADE UNIQUE,
  enabled             boolean     DEFAULT false,
  posting_start_hour  int         DEFAULT 9,
  posting_end_hour    int         DEFAULT 19,
  max_videos_per_day  int         DEFAULT 3,
  max_posts_per_day   int         DEFAULT 10,
  allow_auto_approval boolean     DEFAULT false,
  bilingual_mode      boolean     DEFAULT true,
  critique_percent    int         DEFAULT 15 CHECK (critique_percent BETWEEN 0 AND 100),
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE TRIGGER trg_social_agent_config_updated_at
  BEFORE UPDATE ON vault_social_agent_config
  FOR EACH ROW EXECUTE FUNCTION vault_set_updated_at();

-- -----------------------------------------------------------
-- 4. vault_social_api_keys
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_social_api_keys (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           uuid        NOT NULL REFERENCES auth.users UNIQUE,
  anthropic_api_key  text,
  elevenlabs_api_key text,
  heygen_api_key     text,
  eclincher_api_key  text,
  n8n_webhook_url    text,
  n8n_webhook_secret text,
  ghl_api_key        text,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE TRIGGER trg_social_api_keys_updated_at
  BEFORE UPDATE ON vault_social_api_keys
  FOR EACH ROW EXECUTE FUNCTION vault_set_updated_at();

-- -----------------------------------------------------------
-- 5. vault_social_posts
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_social_posts (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id            uuid        NOT NULL REFERENCES vault_social_brands(id) ON DELETE CASCADE,
  job_id              text,
  platform            text,
  language            text        DEFAULT 'EN',
  content_type        text        DEFAULT 'VIDEO_SHORT',
  hook                text,
  script              text,
  caption             text,
  hashtags            text[]      DEFAULT '{}',
  status              text        DEFAULT 'DRAFT',
  scheduled_at        timestamptz,
  posted_at           timestamptz,
  heygen_video_url    text,
  elevenlabs_audio_url text,
  eclincher_post_id   text,
  thumbnail_url       text,
  metrics             jsonb       DEFAULT '{}',
  error_message       text,
  approved_by         uuid,
  approved_at         timestamptz,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),

  CONSTRAINT chk_post_platform CHECK (
    platform IS NULL OR platform IN ('INSTAGRAM','TIKTOK','YOUTUBE','LINKEDIN','FACEBOOK','X')
  ),
  CONSTRAINT chk_language CHECK (
    language IN ('EN','ES')
  ),
  CONSTRAINT chk_content_type CHECK (
    content_type IN ('VIDEO_SHORT','IMAGE','CAROUSEL','TEXT')
  ),
  CONSTRAINT chk_status CHECK (
    status IN ('DRAFT','READY_TO_RENDER','RENDERING','READY_TO_POST','SCHEDULED','POSTED','FAILED')
  )
);

CREATE INDEX idx_social_posts_brand_id  ON vault_social_posts(brand_id);
CREATE INDEX idx_social_posts_status    ON vault_social_posts(status);
CREATE INDEX idx_social_posts_job_id    ON vault_social_posts(job_id);
CREATE INDEX idx_social_posts_platform  ON vault_social_posts(platform);

CREATE TRIGGER trg_social_posts_updated_at
  BEFORE UPDATE ON vault_social_posts
  FOR EACH ROW EXECUTE FUNCTION vault_set_updated_at();

-- -----------------------------------------------------------
-- 6. vault_social_generation_logs
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_social_generation_logs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    uuid        NOT NULL REFERENCES vault_social_brands(id) ON DELETE CASCADE,
  job_id      text        NOT NULL,
  event_type  text        NOT NULL,
  payload     jsonb       DEFAULT '{}',
  created_at  timestamptz DEFAULT now(),

  CONSTRAINT chk_event_type CHECK (
    event_type IN (
      'GENERATION_STARTED','CONTENT_GENERATED','VIDEO_READY',
      'POST_PUBLISHED','METRICS_UPDATED','ERROR'
    )
  )
);

CREATE INDEX idx_social_gen_logs_brand_id ON vault_social_generation_logs(brand_id);
CREATE INDEX idx_social_gen_logs_job_id   ON vault_social_generation_logs(job_id);

-- =============================================================
-- Row-Level Security
-- =============================================================

ALTER TABLE vault_social_brands           ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_social_connections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_social_agent_config     ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_social_api_keys         ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_social_posts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_social_generation_logs  ENABLE ROW LEVEL SECURITY;

-- Brands: owner or any authenticated user can read; owner can write
CREATE POLICY "brands_select" ON vault_social_brands
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "brands_insert" ON vault_social_brands
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "brands_update" ON vault_social_brands
  FOR UPDATE TO authenticated USING (auth.uid() = owner_id);

CREATE POLICY "brands_delete" ON vault_social_brands
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

-- Connections: authenticated users can read; brand owner can write
CREATE POLICY "connections_select" ON vault_social_connections
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "connections_insert" ON vault_social_connections
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM vault_social_brands b WHERE b.id = brand_id AND b.owner_id = auth.uid())
  );

CREATE POLICY "connections_update" ON vault_social_connections
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM vault_social_brands b WHERE b.id = brand_id AND b.owner_id = auth.uid())
  );

CREATE POLICY "connections_delete" ON vault_social_connections
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM vault_social_brands b WHERE b.id = brand_id AND b.owner_id = auth.uid())
  );

-- Agent config: authenticated read; brand owner write
CREATE POLICY "agent_config_select" ON vault_social_agent_config
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "agent_config_insert" ON vault_social_agent_config
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM vault_social_brands b WHERE b.id = brand_id AND b.owner_id = auth.uid())
  );

CREATE POLICY "agent_config_update" ON vault_social_agent_config
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM vault_social_brands b WHERE b.id = brand_id AND b.owner_id = auth.uid())
  );

CREATE POLICY "agent_config_delete" ON vault_social_agent_config
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM vault_social_brands b WHERE b.id = brand_id AND b.owner_id = auth.uid())
  );

-- API keys: owner only (all operations)
CREATE POLICY "api_keys_select" ON vault_social_api_keys
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);

CREATE POLICY "api_keys_insert" ON vault_social_api_keys
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "api_keys_update" ON vault_social_api_keys
  FOR UPDATE TO authenticated USING (auth.uid() = owner_id);

CREATE POLICY "api_keys_delete" ON vault_social_api_keys
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

-- Posts: authenticated read; brand owner write
CREATE POLICY "posts_select" ON vault_social_posts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "posts_insert" ON vault_social_posts
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM vault_social_brands b WHERE b.id = brand_id AND b.owner_id = auth.uid())
  );

CREATE POLICY "posts_update" ON vault_social_posts
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM vault_social_brands b WHERE b.id = brand_id AND b.owner_id = auth.uid())
  );

CREATE POLICY "posts_delete" ON vault_social_posts
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM vault_social_brands b WHERE b.id = brand_id AND b.owner_id = auth.uid())
  );

-- Generation logs: authenticated read; brand owner write
CREATE POLICY "gen_logs_select" ON vault_social_generation_logs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "gen_logs_insert" ON vault_social_generation_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM vault_social_brands b WHERE b.id = brand_id AND b.owner_id = auth.uid())
  );

-- =============================================================
-- Seed Data — Default brands
-- =============================================================

INSERT INTO vault_social_brands (name, slug, primary_business_type) VALUES
  ('Wolf Surety',       'wolf-surety',       'INSURANCE'),
  ('Re4lty',            're4lty',            'REAL_ESTATE'),
  ('Closed By Whom',    'closed-by-whom',    'TITLE'),
  ('Dispute LLC',       'dispute-llc',       'CREDIT'),
  ('Mansion Signature', 'mansion-signature', 'REAL_ESTATE'),
  ('Tax',               'tax',               'TAX');
