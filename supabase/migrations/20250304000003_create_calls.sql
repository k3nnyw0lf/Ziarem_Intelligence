-- Calls: transcript, recording, LLM-extracted JSON, calculated revenue
CREATE TABLE IF NOT EXISTS public.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  transcript text,
  recording_url text,
  extracted_data jsonb DEFAULT '{}',
  calculated_revenue numeric(14, 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_calls_lead ON public.calls(lead_id);
CREATE INDEX idx_calls_company ON public.calls(company_id);
CREATE INDEX idx_calls_created ON public.calls(created_at DESC);
CREATE INDEX idx_calls_extracted_gin ON public.calls USING gin(extracted_data);

ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read for authenticated" ON public.calls
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow service role full access" ON public.calls
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.calls IS 'Call records with Vapi transcript and Gemini-extracted JSON';
