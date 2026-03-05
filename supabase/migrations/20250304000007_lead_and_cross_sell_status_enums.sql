-- Phase 1 (Ziarem): Enforce lead status enum and cross_sell status enum per directive.
-- Lead status: Cold, Qualified, Under Contract, Closed.
-- Cross-sell status: Pending, Automated_Outreach, Closed.

-- Normalize existing lead statuses to allowed values before adding constraint.
UPDATE public.leads
SET status = 'Cold'
WHERE status IS NULL OR status NOT IN ('Cold', 'Qualified', 'Under Contract', 'Closed');

ALTER TABLE public.leads
  ALTER COLUMN status SET DEFAULT 'Cold';

ALTER TABLE public.leads
  ADD CONSTRAINT leads_status_check CHECK (
    status IN ('Cold', 'Qualified', 'Under Contract', 'Closed')
  );

-- Normalize existing cross_sell statuses; map legacy 'Contacted' to 'Automated_Outreach'.
UPDATE public.cross_sells
SET status = 'Automated_Outreach'
WHERE status = 'Contacted';

ALTER TABLE public.cross_sells
  DROP CONSTRAINT IF EXISTS cross_sells_status_check;

ALTER TABLE public.cross_sells
  ADD CONSTRAINT cross_sells_status_check CHECK (
    status IN ('Pending', 'Automated_Outreach', 'Closed')
  );

COMMENT ON COLUMN public.leads.status IS 'Cold | Qualified | Under Contract | Closed';
COMMENT ON COLUMN public.cross_sells.status IS 'Pending | Automated_Outreach | Closed';
