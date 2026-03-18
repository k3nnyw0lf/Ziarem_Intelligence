-- Companies: internal and partner entities for routing and cross-sell
CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  vertical text NOT NULL,
  is_partner boolean NOT NULL DEFAULT false,
  active_status boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_companies_vertical ON public.companies(vertical);
CREATE INDEX idx_companies_active ON public.companies(active_status) WHERE active_status = true;

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read for authenticated" ON public.companies
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow service role full access" ON public.companies
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.companies IS 'Bilingual CRM: companies/verticals for routing and cross-sell';
