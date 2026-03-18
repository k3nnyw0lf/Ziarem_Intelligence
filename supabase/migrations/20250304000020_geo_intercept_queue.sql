-- Phase 9: Geo-intercept — high-priority queue for "Intercept Call" within 15 min (replaces Redis)
CREATE TABLE IF NOT EXISTS public.lead_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(device_id)
);

CREATE INDEX idx_lead_devices_lead ON public.lead_devices(lead_id);
CREATE INDEX idx_lead_devices_device ON public.lead_devices(device_id);

CREATE TABLE IF NOT EXISTS public.intercept_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  device_id text,
  geofence_name text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  scheduled_before_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dispatched', 'completed', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_intercept_queue_status ON public.intercept_queue(status);
CREATE INDEX idx_intercept_queue_scheduled ON public.intercept_queue(scheduled_before_at) WHERE status = 'pending';

ALTER TABLE public.lead_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intercept_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access lead_devices" ON public.lead_devices FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access intercept_queue" ON public.intercept_queue FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.intercept_queue IS 'Phase 9: Geo-intercept high-priority queue for Vapi Intercept Call within 15 min';
