-- Phase 9: Entity resolution & network graph for Warm Intro campaigns
CREATE TABLE IF NOT EXISTS public.network_graph (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  connected_person_name text,
  connected_phone text,
  relationship_type text NOT NULL CHECK (relationship_type IN ('Family', 'Business Partner', 'Other')),
  warm_intro_status text NOT NULL DEFAULT 'pending' CHECK (warm_intro_status IN ('pending', 'contacted', 'converted', 'skipped')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_network_graph_primary ON public.network_graph(primary_lead_id);
CREATE INDEX idx_network_graph_warm_intro ON public.network_graph(warm_intro_status) WHERE warm_intro_status = 'pending';

ALTER TABLE public.network_graph ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access network_graph" ON public.network_graph FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.network_graph IS 'Phase 9: 1st-degree connections for Warm Intro AI campaign';
