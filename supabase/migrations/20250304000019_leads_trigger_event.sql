-- Phase 8 OSINT: flag leads with public-record trigger events (permits, NOD, new LLC)
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS trigger_event text,
  ADD COLUMN IF NOT EXISTS trigger_event_metadata jsonb DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_leads_trigger_event ON public.leads(trigger_event) WHERE trigger_event IS NOT NULL;

COMMENT ON COLUMN public.leads.trigger_event IS 'OSINT: e.g. building_permit, notice_of_default, new_llc';
COMMENT ON COLUMN public.leads.trigger_event_metadata IS 'OSINT: source URL, date, address, etc.';
