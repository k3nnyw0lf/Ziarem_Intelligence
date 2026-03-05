-- Phase 9: Allow vision_render in interactions
ALTER TABLE public.interactions DROP CONSTRAINT IF EXISTS interactions_type_check;
ALTER TABLE public.interactions ADD CONSTRAINT interactions_type_check
  CHECK (type IN ('voice_call', 'inbound_sms', 'outbound_email', 'vision_render'));
