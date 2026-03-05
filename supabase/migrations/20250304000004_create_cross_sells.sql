-- Cross-sells: auto-created when anchor vertical (e.g. Re4lty) triggers partner/internal routing
CREATE TABLE IF NOT EXISTS public.cross_sells (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  target_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Contacted', 'Closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(original_lead_id, target_company_id)
);

CREATE INDEX idx_cross_sells_lead ON public.cross_sells(original_lead_id);
CREATE INDEX idx_cross_sells_company ON public.cross_sells(target_company_id);
CREATE INDEX idx_cross_sells_status ON public.cross_sells(status);

ALTER TABLE public.cross_sells ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read for authenticated" ON public.cross_sells
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow service role full access" ON public.cross_sells
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.cross_sells IS 'Cross-sell routing from anchor verticals to partners/internal';
