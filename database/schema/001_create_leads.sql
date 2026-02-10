-- Ziarem: leads table optimized for ~1,000,000 rows
-- Run on Hostinger VPS PostgreSQL

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Allowed business tags (enforced at DB level)
CREATE TYPE ziarem_business_tag AS ENUM ('Lyco', 'Wolf', 'Dispute');

CREATE TABLE leads (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name   VARCHAR(255) NOT NULL,
  last_name    VARCHAR(255) NOT NULL,
  email        VARCHAR(255) NOT NULL,
  phone        VARCHAR(50),
  business_tags ziarem_business_tag[] DEFAULT '{}',
  lead_score   SMALLINT NOT NULL DEFAULT 0 CHECK (lead_score >= 0 AND lead_score <= 100),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for high-volume lookups and pagination
CREATE INDEX idx_leads_email ON leads (email);
CREATE INDEX idx_leads_phone ON leads (phone);
CREATE INDEX idx_leads_created_at ON leads (created_at DESC);  -- efficient pagination by time
CREATE INDEX idx_leads_lead_score ON leads (lead_score DESC);  -- optional: sort by score

-- Optional: GIN index if you filter by business_tags often
CREATE INDEX idx_leads_business_tags ON leads USING GIN (business_tags);

-- Optional: composite for common filter + sort (e.g. list by score then time)
-- CREATE INDEX idx_leads_score_created ON leads (lead_score DESC, created_at DESC);

COMMENT ON TABLE leads IS 'Ziarem leads; optimized for ~1M rows with indexed email/phone and pagination.';
