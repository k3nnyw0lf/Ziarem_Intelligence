-- Ziarem Enterprise: child leads for cross-sell. Parent lead can have child records
-- (one per target vertical) linked via parent_lead_id; company_id indicates target vertical.
-- Unique phone_number only for root leads (parent_lead_id IS NULL).

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS parent_lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_parent ON public.leads(parent_lead_id);
CREATE INDEX IF NOT EXISTS idx_leads_company ON public.leads(company_id);

-- Allow duplicate phone_number for child leads; unique only for root.
DROP INDEX IF EXISTS public.leads_phone_number_key;
CREATE UNIQUE INDEX leads_phone_number_root_key ON public.leads(phone_number) WHERE parent_lead_id IS NULL;

COMMENT ON COLUMN public.leads.parent_lead_id IS 'Set for cross-sell child leads; links to Re4lty parent.';
COMMENT ON COLUMN public.leads.company_id IS 'Target company/vertical for this lead (e.g. child lead for Dos Mortgage).';
