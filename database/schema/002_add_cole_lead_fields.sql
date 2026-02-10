-- Cole Data Dictionary (FA + CP) lead fields; auto-identify imports from this source
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS source        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS source_id    VARCHAR(100),
  ADD COLUMN IF NOT EXISTS address_1     VARCHAR(255),
  ADD COLUMN IF NOT EXISTS city         VARCHAR(100),
  ADD COLUMN IF NOT EXISTS state        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS zip_code     VARCHAR(20),
  ADD COLUMN IF NOT EXISTS mobile_phone VARCHAR(50);

-- Dedupe Cole leads by (source, source_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_source_source_id
  ON leads (source, source_id) WHERE source IS NOT NULL AND source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_source ON leads (source);
CREATE INDEX IF NOT EXISTS idx_leads_zip_code ON leads (zip_code);

COMMENT ON COLUMN leads.source IS 'Import source e.g. Cole (from Cole Data Dictionary)';
COMMENT ON COLUMN leads.source_id IS 'External id from source (e.g. ID_Individuals for Cole)';
