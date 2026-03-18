-- Phase 6: Omnichannel infinite memory – interactions (voice_call, inbound_sms, outbound_email)
CREATE TABLE IF NOT EXISTS public.interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('voice_call', 'inbound_sms', 'outbound_email')),
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  phone_number text NOT NULL,
  summary text,
  transcript text,
  payload jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_interactions_phone ON public.interactions(phone_number);
CREATE INDEX idx_interactions_lead ON public.interactions(lead_id);
CREATE INDEX idx_interactions_created ON public.interactions(created_at DESC);
CREATE INDEX idx_interactions_type ON public.interactions(type);

ALTER TABLE public.interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read for authenticated" ON public.interactions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow service role full access" ON public.interactions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Backfill from existing calls (voice_call)
INSERT INTO public.interactions (type, lead_id, phone_number, summary, transcript, payload, created_at)
SELECT
  'voice_call',
  c.lead_id,
  l.phone_number,
  (c.extracted_data->>'lead_intent')::text,
  c.transcript,
  jsonb_build_object(
    'call_id', c.id,
    'company_id', c.company_id,
    'extracted_data', c.extracted_data,
    'calculated_revenue', c.calculated_revenue
  ),
  c.created_at
FROM public.calls c
JOIN public.leads l ON l.id = c.lead_id;

COMMENT ON TABLE public.interactions IS 'Omnichannel: voice_call, inbound_sms, outbound_email for RAG context';
