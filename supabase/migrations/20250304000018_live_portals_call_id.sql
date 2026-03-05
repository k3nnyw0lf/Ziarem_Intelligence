-- Optional: link portal to active Vapi call so we can send "prospect_is_viewing" via control API
ALTER TABLE public.live_portals
  ADD COLUMN IF NOT EXISTS call_id text;

COMMENT ON COLUMN public.live_portals.call_id IS 'Vapi call ID for control API (e.g. add-message when prospect views)';
