-- Ziarem Omni-SMTP Marketing Engine – schema
-- Run after leads table exists (leads.autoId_ui for FKs).

-- Ensure UUID extension is available
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ========== Task 1: SMTP identities ==========
CREATE TABLE smtp_identities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_tag VARCHAR(50) NOT NULL,
  from_name    VARCHAR(255) NOT NULL,
  from_email   VARCHAR(255) NOT NULL,
  smtp_host    VARCHAR(255) NOT NULL,
  smtp_port    INTEGER NOT NULL,
  smtp_user    VARCHAR(255) NOT NULL,
  smtp_pass    TEXT NOT NULL,
  daily_limit  INTEGER NOT NULL DEFAULT 500 CHECK (daily_limit >= 0),
  sent_today   INTEGER NOT NULL DEFAULT 0 CHECK (sent_today >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_smtp_identities_business_tag ON smtp_identities (business_tag);

COMMENT ON TABLE smtp_identities IS 'Omni-SMTP: sending identities per business (WOLF, LYCO, DISPUTE). smtp_pass should be stored encrypted by the application.';
COMMENT ON COLUMN smtp_identities.sent_today IS 'Reset daily by application or cron.';

-- ========== Task 2: Marketing campaigns ==========
CREATE TYPE campaign_status AS ENUM ('Draft', 'Active', 'Completed');

CREATE TABLE marketing_campaigns (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(255) NOT NULL,
  business_tag VARCHAR(50) NOT NULL,
  status       campaign_status NOT NULL DEFAULT 'Draft',
  template_html TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_marketing_campaigns_business_tag ON marketing_campaigns (business_tag);
CREATE INDEX idx_marketing_campaigns_status ON marketing_campaigns (status);

-- ========== Task 2: Campaign queue ==========
CREATE TYPE queue_item_status AS ENUM ('Pending', 'Sent', 'Failed');

CREATE TABLE campaign_queue (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  lead_id      BIGINT REFERENCES leads(autoId_ui) ON DELETE SET NULL,
  status       queue_item_status NOT NULL DEFAULT 'Pending',
  scheduled_for TIMESTAMPTZ,
  sent_at      TIMESTAMPTZ,
  error_message TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaign_queue_campaign_id ON campaign_queue (campaign_id);
CREATE INDEX idx_campaign_queue_lead_id ON campaign_queue (lead_id);
CREATE INDEX idx_campaign_queue_status ON campaign_queue (status);
CREATE INDEX idx_campaign_queue_scheduled_for ON campaign_queue (scheduled_for) WHERE status = 'Pending';

-- ========== Task 3: Email tracking ==========
CREATE TABLE email_tracking (
  tracking_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      BIGINT REFERENCES leads(autoId_ui) ON DELETE SET NULL,
  opened_at    TIMESTAMPTZ,
  clicked_link TEXT,
  clicked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_tracking_lead_id ON email_tracking (lead_id);
CREATE INDEX idx_email_tracking_opened_at ON email_tracking (opened_at) WHERE opened_at IS NOT NULL;

COMMENT ON TABLE email_tracking IS 'Opens and link clicks per sent email; tracking_id is embedded in the email.';
