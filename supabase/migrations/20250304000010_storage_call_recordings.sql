-- Supabase Storage: public bucket for permanent call recording retention
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'call-recordings',
  'call-recordings',
  true,
  52428800,
  ARRAY['audio/wav', 'audio/mpeg', 'audio/webm', 'audio/mp4', 'audio/x-wav']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policies for call-recordings bucket (drop if re-running)
DROP POLICY IF EXISTS "call_recordings_service_upload" ON storage.objects;
DROP POLICY IF EXISTS "call_recordings_service_update" ON storage.objects;
DROP POLICY IF EXISTS "call_recordings_public_read" ON storage.objects;

CREATE POLICY "call_recordings_service_upload"
ON storage.objects FOR INSERT TO service_role
WITH CHECK (bucket_id = 'call-recordings');

CREATE POLICY "call_recordings_service_update"
ON storage.objects FOR UPDATE TO service_role
USING (bucket_id = 'call-recordings');

CREATE POLICY "call_recordings_public_read"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'call-recordings');
