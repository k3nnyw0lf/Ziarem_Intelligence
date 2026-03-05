-- Phase 6: Live Agent Co-Pilot – transfer status for Whisper UI
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS agent_transfer_status text;

CREATE INDEX IF NOT EXISTS idx_calls_agent_transfer ON public.calls(agent_transfer_status)
  WHERE agent_transfer_status IS NOT NULL;

COMMENT ON COLUMN public.calls.agent_transfer_status IS 'e.g. Transferring_to_Ken; when set, WhisperCard shows intent_summary, estimated_value, transcript.';
