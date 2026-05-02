---
name: hermes-keys
description: Use this skill whenever you need an external service key (API key, secret, base URL) at runtime. Resolves names against the live `public.credentials` table in Supabase, which is the ONE source of truth for every Hermes/agent-fleet/messaging-gateway/Ziarem-business key. Never paste keys into chat. Trigger on: "what's the X key", "test the connection to Y", "is Z configured", "list missing keys", "credentials status".
---

# Keys via Supabase credentials catalog

Every key the Ziarem stack needs is registered in `public.credentials`,
populated by migration `20260501000000_credentials_catalog.sql`.
Operators set the actual values via the admin UI; Hermes / agents /
gateways pull them at runtime.

## Read a single key

```sql
SELECT api_key, api_secret, base_url, config, notes
FROM public.credentials
WHERE service_name = $service_name;
```

Use `service_name` exactly as registered (case-sensitive). Common ones:

| Need                    | service_name                                |
| ----------------------- | ------------------------------------------- |
| Hermes default LLM      | `Anthropic Claude API` (live; preferred)    |
| Hermes fallback (Google) | `Google Gemini API` (optional, via `hermes fallback add`) |
| Hermes fallback         | `OpenRouter API (Hermes fallback)`          |
| Crawl4AI / Mem0 / Pipecat shared LLM | `OpenAI API (shared by Crawl4AI/Mem0/Pipecat)` |
| Vapi calls              | `Vapi - AI Voice Calls`                     |
| Twilio SMS              | `Twilio - Phone/SMS`                        |
| Telegram bot            | `Telegram Bot - Hermes Gateway`             |
| Slack bot (xoxb-)       | `Slack Bot - Hermes Gateway`                |
| Slack app (xapp-)       | `Slack App Token - Hermes Socket Mode`      |
| WhatsApp                | `WhatsApp Business API - Hermes Gateway`    |
| Skyvern RPA             | `Skyvern RPA (after deployment)`            |
| Mailgun (omni-sender)   | `Mailgun - Email Provider`                  |
| Resend                  | `Resend - Email Provider`                   |
| Cloudflare Turnstile    | `Cloudflare Turnstile - Apply Form`         |
| GitHub Skills Hub       | `GitHub PAT - Hermes Skills Hub`            |
| GitHub OpenHands        | `GitHub PAT - OpenHands`                    |

## List what's missing (admin sanity check)

```sql
SELECT category, service_name, base_url, notes
FROM public.v_credentials_admin
WHERE NOT has_api_key
ORDER BY category, service_name;
```

The `v_credentials_admin` view never exposes the actual key/secret —
only presence flags. Safe to surface to operators.

## Add a NEW service the catalog doesn't know about

```sql
INSERT INTO public.credentials (service_name, category, base_url, notes)
VALUES ($name, $category, $base_url, $notes)
ON CONFLICT (service_name) DO NOTHING;
```

Pick a category from the existing taxonomy:
`ai_services | agent_fleet | messaging_gateway | voice | email_provider |
research | automation | github | compliance | infrastructure | mls |
wolf_machine | personal | general`. Don't invent new categories
casually — the admin UI groups by category.

## Hard rules

- **NEVER** print `api_key` / `api_secret` / `smtp_pass` values to chat.
  If the user asks "what's my Vapi key", answer "set" / "not set" only.
- **NEVER** UPDATE the `credentials` table from a chat surface (Slack /
  Telegram). Only the admin UI on the secure subnet is allowed to write.
- **NEVER** select `api_key` / `api_secret` into a query whose result
  the operator might paste into a screenshot. Use `v_credentials_admin`
  for any read where the value isn't immediately needed.
- After populating a key, **test the connection** before declaring it
  done. The admin UI's per-service test-connection button (lead-manager-crm
  pattern) is the right surface; for Hermes services use
  `hermes mcp test <name>` or `hermes doctor`.
- **Rotation**: when rotating a key, update `credentials.api_key` first,
  then bounce any service that caches it (Hermes gateway, omni_sender
  cron, etc).
