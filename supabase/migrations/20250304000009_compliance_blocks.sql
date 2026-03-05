-- Florida TCPA / Mini-TCPA: log when a dial is blocked (time-zone or frequency cap)
CREATE TABLE IF NOT EXISTS public.compliance_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('time_zone_fence', 'frequency_cap')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_compliance_blocks_phone ON public.compliance_blocks(phone_number);
CREATE INDEX idx_compliance_blocks_created ON public.compliance_blocks(created_at DESC);

ALTER TABLE public.compliance_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read for authenticated" ON public.compliance_blocks
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow service role full access" ON public.compliance_blocks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.compliance_blocks IS 'Florida TCPA: log blocked dial attempts (8am-8pm ET fence, 3 calls/24h cap)';
