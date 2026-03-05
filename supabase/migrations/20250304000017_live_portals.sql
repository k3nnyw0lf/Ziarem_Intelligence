-- Phase 7: Live Canvas Engine – prospect portal rows for generative mid-call UI
CREATE TABLE IF NOT EXISTS public.live_portals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  active_verticals jsonb NOT NULL DEFAULT '[]'::jsonb,
  dynamic_math jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_viewing boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_live_portals_lead ON public.live_portals(lead_id);
CREATE INDEX idx_live_portals_updated ON public.live_portals(updated_at DESC);

ALTER TABLE public.live_portals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read for anon (prospect link)" ON public.live_portals
  FOR SELECT TO anon USING (true);

CREATE POLICY "Allow service role full access" ON public.live_portals
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Allow authenticated (dashboard) to update is_viewing and read
CREATE POLICY "Allow anon update is_viewing (prospect focus)" ON public.live_portals
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

COMMENT ON TABLE public.live_portals IS 'Phase 7: Real-time prospect portal; dynamic_math drives Dos/Laenan/RENO/Wolf UI';

-- Realtime for live_portals so prospect page gets instant updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_portals;
