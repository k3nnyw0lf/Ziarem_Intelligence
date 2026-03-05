-- Phase 6: Predictive Whale lead scoring (1-99)
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS propensity_score int;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_propensity_score_check
  CHECK (propensity_score IS NULL OR (propensity_score >= 1 AND propensity_score <= 99));

CREATE INDEX IF NOT EXISTS idx_leads_propensity ON public.leads(propensity_score DESC NULLS LAST);

COMMENT ON COLUMN public.leads.propensity_score IS 'Whale score 1-99 from daily score-leads job; Cold leads ordered by this for outbound.';
