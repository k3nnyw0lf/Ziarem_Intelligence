-- Ziarem Unified Communication Engine – email credentials + communications log
-- Run after schema.sql (leads table must exist for lead_id FK).

-- Stores SMTP/IMAP credentials for each business (e.g. Lyco, Wolf, Dispute)
CREATE TABLE business_emails (
  id          SERIAL PRIMARY KEY,
  business_name VARCHAR(100) NOT NULL UNIQUE,
  email_user  VARCHAR(255) NOT NULL,
  email_pass  TEXT NOT NULL,
  smtp_host   VARCHAR(255) NOT NULL,
  imap_host   VARCHAR(255) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- All sent/received emails; lead_id links to leads.autoId_ui or leads.id depending on your leads PK
CREATE TABLE communications (
  id          SERIAL PRIMARY KEY,
  lead_id     BIGINT,
  direction   VARCHAR(20) NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND')),
  subject     VARCHAR(500),
  body_text   TEXT,
  body_html   TEXT,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  business_id INTEGER REFERENCES business_emails(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_communications_lead_id ON communications (lead_id);
CREATE INDEX idx_communications_sent_at ON communications (sent_at DESC);
CREATE INDEX idx_communications_lead_sent ON communications (lead_id, sent_at DESC);

ALTER TABLE communications ADD CONSTRAINT fk_communications_lead
  FOREIGN KEY (lead_id) REFERENCES leads(autoId_ui) ON DELETE SET NULL;

COMMENT ON TABLE business_emails IS 'SMTP/IMAP credentials per business. Seed: node scripts/seed_business_emails.js (see config/businesses.js).';
COMMENT ON TABLE communications IS 'Unified inbox: all emails by lead; timeline view by lead_id + sent_at.';
