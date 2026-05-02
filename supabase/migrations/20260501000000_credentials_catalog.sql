-- Credentials catalog — seed every key Hermes / agent fleet / messaging
-- gateway / Ziarem business needs into public.credentials so the admin UI
-- can populate them in one place.
--
-- Idempotent: ON CONFLICT (service_name) DO NOTHING. Existing rows
-- (Anthropic, Supabase, Skyvern, MLS providers, etc.) are never touched.
-- Only NEW service_names get inserted.
--
-- Category convention (admin UI groups by this):
--   ai_services        — LLM providers
--   agent_fleet        — Hermes self-hosted services
--   messaging_gateway  — Telegram/Discord/Slack/WhatsApp/Signal/Email
--   voice              — Vapi/Retell/Twilio/Telnyx
--   email_provider     — SMTP rotation pool (Mailgun/Resend/Postmark/...)
--   research           — Exa/Tavily/Firecrawl/Parallel
--   automation         — n8n
--   github             — PATs for repos + Skills Hub
--   wolf_machine       — Wolf Machine LAN-hosted services
--
-- After applying: the admin UI lists rows where api_key IS NULL/'' and
-- prompts the operator to fill them.

-- Defensive: this table already exists in every real Ziarem deploy
-- (UNIQUE on service_name etc). The CREATE IF NOT EXISTS is here only
-- so the SQL CI job can apply this migration against a fresh Postgres
-- without first running 1,000 lines of legacy migrations.
CREATE TABLE IF NOT EXISTS public.credentials (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name text UNIQUE NOT NULL,
  api_key      text,
  api_secret   text,
  base_url     text,
  config       jsonb,
  notes        text,
  category     text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.credentials (service_name, category, base_url, notes) VALUES

-- ─── AI services / LLM providers ──────────────────────────────────────────
('Google Gemini API',                'ai_services', 'https://generativelanguage.googleapis.com',
 'Hermes default model (gemini-2.5-pro). Same key used by transcript extraction in api/webhooks/vapi-call-end.'),
('OpenAI API (shared by Crawl4AI/Mem0/Pipecat)', 'ai_services', 'https://api.openai.com',
 'Required by Crawl4AI relevance filter, Mem0 embeddings, Pipecat fallback. NOT used by Hermes itself.'),
('OpenRouter API (Hermes fallback)',  'ai_services', 'https://openrouter.ai/api/v1',
 'Hermes fallback chain provider. Set via `hermes fallback add`.'),
('Nous Portal API',                   'ai_services', 'https://portal.nousresearch.com',
 'Optional Hermes-native provider. Auth via `hermes login`.'),

-- ─── Agent fleet (Hermes-managed services) ────────────────────────────────
('Hermes Agent Home',                 'agent_fleet', 'file:///root/.hermes',
 'Per-machine Hermes data directory. api_key field unused; reference only.'),
('Crawl4AI Server',                   'agent_fleet', 'http://10.1.10.42:11235',
 'Self-hosted at Wolf Machine. api_key field holds CRAWL4AI_API_TOKEN. Default port 11235.'),
('Mem0 Memory API',                   'agent_fleet', 'http://10.1.10.42:8080',
 'Self-hosted with own pgvector Postgres. Authless on internal LAN; api_key empty unless reverse-proxied with auth.'),
('Pipecat Voice Server',              'agent_fleet', 'http://10.1.10.42:7860',
 'Voice composer over Vapi. Authless on internal LAN.'),
('OpenHands Agent Server',            'agent_fleet', 'http://10.1.10.42:3010',
 'Issue-driven coding agent. Bound to 3010 to avoid Next.js 3000 / Node API 3001.'),

-- ─── Messaging gateway (Hermes) ───────────────────────────────────────────
('Telegram Bot - Hermes Gateway',     'messaging_gateway', 'https://api.telegram.org',
 'Bot token from @BotFather. Goes into ~/.hermes/.env as TELEGRAM_BOT_TOKEN.'),
('Discord Bot - Hermes Gateway',      'messaging_gateway', 'https://discord.com/developers/applications',
 'Bot token. Default toolset locks down terminal/file_write per platform_toolsets.'),
('Slack Bot - Hermes Gateway',        'messaging_gateway', 'https://api.slack.com/apps',
 'Two tokens: SLACK_BOT_TOKEN (xoxb-) in api_key, SLACK_APP_TOKEN (xapp-) in api_secret.'),
('Slack App Token - Hermes Socket Mode', 'messaging_gateway', 'https://api.slack.com/apps',
 'xapp- token (separate row for clarity). Socket-mode connection.'),
('WhatsApp Business API - Hermes Gateway', 'messaging_gateway', 'https://graph.facebook.com',
 'WHATSAPP_API_TOKEN. Choose ONE owner: Hermes OR existing wa-bridge/. Never both against the same number.'),
('Signal CLI - Hermes Gateway',       'messaging_gateway', 'https://signal.org',
 'SIGNAL_PHONE_NUMBER (registered number). signal-cli is shipped in Hermes binary.'),

-- ─── Voice (AI sales floor) ───────────────────────────────────────────────
('Vapi - AI Voice Calls',             'voice', 'https://api.vapi.ai',
 'VAPI_PRIVATE_KEY in api_key, NEXT_PUBLIC_VAPI_PUBLIC_KEY in api_secret. VAPI_CONTROL_BASE_URL in base_url.'),
('Retell AI - Voice Backup',          'voice', 'https://api.retellai.com',
 'Optional secondary voice provider; failover for Vapi.'),
('Twilio - Phone/SMS',                'voice', 'https://api.twilio.com',
 'TWILIO_ACCOUNT_SID in api_key, TWILIO_AUTH_TOKEN in api_secret, TWILIO_PHONE_NUMBER in base_url.'),
('Deepgram - STT for Pipecat',        'voice', 'https://api.deepgram.com',
 'Real-time speech-to-text. Pipecat dependency.'),
('ElevenLabs - TTS for Pipecat',      'voice', 'https://api.elevenlabs.io',
 'Real-time text-to-speech. Optional — Pipecat falls back to OpenAI TTS / Edge TTS.'),

-- ─── Email rotation pool (omni_sender + Hermes outbound) ─────────────────
('Mailgun - Email Provider',          'email_provider', 'https://api.mailgun.net',
 'Used by sender_rotation.py adapter "mailgun". Goes into vault_email_senders row(s).'),
('Resend - Email Provider',           'email_provider', 'https://api.resend.com',
 'RESEND_API_KEY. Adapter "resend".'),
('Postmark - Email Provider',         'email_provider', 'https://api.postmarkapp.com',
 'Adapter "postmark".'),
('SendGrid - Email Provider',         'email_provider', 'https://api.sendgrid.com',
 'Adapter "sendgrid".'),
('AWS SES - Email Provider',          'email_provider', 'https://email.us-east-1.amazonaws.com',
 'Adapter "ses-sigv4". api_key=AWS_ACCESS_KEY_ID, api_secret=AWS_SECRET_ACCESS_KEY, base_url=region endpoint.'),

-- ─── Research / web ───────────────────────────────────────────────────────
('Exa Search API',                    'research', 'https://api.exa.ai',
 'Premium semantic search. Hermes web skill.'),
('Tavily Search API',                 'research', 'https://api.tavily.com',
 'Cheaper alt to Exa for the Hermes web skill.'),
('Firecrawl API',                     'research', 'https://api.firecrawl.dev',
 'Managed crawler. Hermes web skill optional dep; alt to self-hosted Crawl4AI.'),
('Parallel AI',                       'research', 'https://api.parallel.ai',
 'Mixture-of-agents reasoning. Hermes moa skill.'),

-- ─── GitHub PATs ──────────────────────────────────────────────────────────
('GitHub PAT - Hermes Skills Hub',    'github', 'https://github.com',
 'Lifts the 60 req/hr unauth rate limit on Skills Hub installs. Goes in ~/.hermes/.env GITHUB_TOKEN.'),
('GitHub PAT - Downstream Repo Dispatch', 'github', 'https://github.com',
 'repo:write scope on every Ziarem repo. Used by hermes-sync.yml to fan out repository_dispatch.'),
('GitHub PAT - OpenHands',            'github', 'https://github.com',
 'repo scope. Used by docker-compose openhands service to file PRs.'),

-- ─── Compliance / TCPA / verification ─────────────────────────────────────
('TCPA Firewall',                     'compliance', NULL,
 'TCPA_FIREWALL_URL + TCPA_FIREWALL_API_KEY. DNC scrubbing pre-call.'),
('Abstract API - Email Verification', 'compliance', 'https://emailvalidation.abstractapi.com',
 'ABSTRACT_EMAIL_API_KEY. Used by lead enrichment.'),
('Abstract API - Phone Verification', 'compliance', 'https://phonevalidation.abstractapi.com',
 'ABSTRACT_PHONE_API_KEY.'),
('NumVerify - Phone Validation',      'compliance', 'http://apilayer.net/api/validate',
 'NUMVERIFY_API_KEY.'),

-- ─── Compliance — DocuSign already exists, leave alone ────────────────────

-- ─── Cloudflare (worker for laenan/ziarem.com) ───────────────────────────
('Cloudflare - Workers + KV',         'infrastructure', 'https://api.cloudflare.com',
 'Account API token with Workers + KV scopes. Powers the bridge worker.'),
('Cloudflare Turnstile - Apply Form', 'infrastructure', 'https://challenges.cloudflare.com',
 'TURNSTILE_SITE_KEY (api_key, public) + TURNSTILE_SECRET (api_secret, server-side verify).')

ON CONFLICT (service_name) DO NOTHING;

-- ─── Convenience: a view the admin UI can read to find empty/missing keys.
CREATE OR REPLACE VIEW public.v_credentials_admin AS
  SELECT
    id,
    service_name,
    category,
    base_url,
    CASE
      WHEN api_key    IS NULL OR api_key    = '' THEN false ELSE true
    END AS has_api_key,
    CASE
      WHEN api_secret IS NULL OR api_secret = '' THEN false ELSE true
    END AS has_api_secret,
    notes,
    updated_at
  FROM public.credentials;

COMMENT ON VIEW public.v_credentials_admin IS
  'Read-friendly credentials list for admin UIs. Never exposes the actual key/secret values, only presence flags.';
