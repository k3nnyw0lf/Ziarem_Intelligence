-- Store API enrichment results (email/phone validation, IP geo, geocode cache)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS enrichment_result JSONB;
COMMENT ON COLUMN leads.enrichment_result IS 'Cached result from GET /leads/:id/enrich: { email, phone, ip, geocode? }. lat/lon updated separately.';
