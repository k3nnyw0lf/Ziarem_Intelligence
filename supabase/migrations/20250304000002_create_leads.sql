-- Leads: contact and intent data, bilingual (EN/ES), default Naples/Florida
CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number text NOT NULL,
  first_name text,
  last_name text,
  preferred_language text NOT NULL DEFAULT 'EN' CHECK (preferred_language IN ('EN', 'ES')),
  location text DEFAULT 'Naples, Florida',
  estimated_value numeric(14, 2),
  status text NOT NULL DEFAULT 'New',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(phone_number)
);

CREATE INDEX idx_leads_phone ON public.leads(phone_number);
CREATE INDEX idx_leads_status ON public.leads(status);
CREATE INDEX idx_leads_language ON public.leads(preferred_language);
CREATE INDEX idx_leads_updated ON public.leads(updated_at DESC);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read for authenticated" ON public.leads
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow service role full access" ON public.leads
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.leads IS 'Bilingual CRM: leads with Naples/Florida default market';
