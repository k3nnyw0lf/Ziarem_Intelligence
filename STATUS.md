# Ziarem AI Inbox — Live Status

Snapshot of what's deployed, what's verified, and what remains gated by user action.

## ✅ Live & verified (autonomous work)

### Supabase project `sfelhasepvaoianyuvxe`

- **`email_intake` schema patched**: added `message_id` (UNIQUE) + `to_email` columns + indexes.
- **`email-monitor` Edge Function v9 deployed**: reads n8n's actual field names, dedupes by Message-ID, AI output goes into the existing `ai_parsed` JSONB.
- **CRM auto-match trigger** (`email_intake_match_contact`): every `INSERT INTO email_intake` matches `from_email` against business client tables and stamps the result into `ai_parsed.matched_contact`. Lookup priority by inbox domain:
  - `*@wolfsurety.com / *@wolfinsure.com` → `ws_clients`
  - `*@dosmortgage.com / *@laenan.com`     → `dm_loans` (client_email or title_email)
  - `*@re4lty.com / *@closedbywhom.com`    → `re4lty_leads` (also bumps `last_contacted_at`)
  - Fallback → `contacts` → `clients`
- **Two new views**:
  - `v_email_intake_with_contact` — flat view, JSONB exploded.
  - `v_contact_email_stats` — per-contact email rollup (count, last_received, urgent count).

### GitHub `k3nnyw0lf/Ziarem_Intelligence`

- Pushed: AI inbox engine (009 LLM router, AI triage, lead match, ai_worker, backfill, /inbox routes).
- Pushed: `/inbox/webhook/n8n` receiver in Ziarem.
- Pushed: `INBOX_AI_SETUP.md`, `N8N_INTEGRATION.md`, this file.
- This commit adds Dockerfile, docker-compose.yml, scripts/deploy_to_vps1.sh.

### Local

- Removed: `wolf-mail-hq` scaffold (611 MB) and Supabase `wmh.*` schema + 3 storage buckets.

---

## 🚧 Verified working today

```bash
# email-monitor v9 status
curl https://sfelhasepvaoianyuvxe.supabase.co/functions/v1/email-monitor?action=status
# → {"status":"active","version":9,"total":N,"last_24h":N}
```

```sql
-- New emails landing properly with AI + CRM match
select message_id, from_email, to_email, subject,
       ai_parsed->>'intent' as intent,
       ai_parsed->'matched_contact' as matched_contact
from public.email_intake order by created_at desc limit 10;
```

```sql
-- Per-contact rollup (what's the conversation history with each known contact?)
select * from public.v_contact_email_stats order by last_received_at desc;
```

---

## 🔒 User-gated (need your green light or manual action)

### 1. Activate live email flow for Re4lty / DOS / Laenan / Wolf Insurance
**Why blocked:** n8n REST API doesn't expose secrets, so I can't add IMAP credentials to the n8n credential vault from outside the UI.

**You do (5 min total):**
1. n8n UI → Credentials → New → IMAP for each: `kenneth@re4lty.com`, `kenneth@dosmortgage.com`, `kenneth@laenan.com`, `kenneth@wolfinsure.com` (or whichever inbox).
2. Right-click `Wolf - Email Monitor` → Duplicate × 4. Rename: `Re4lty - Email Monitor`, `DOS Mortgage - Email Monitor`, etc.
3. In each duplicate, attach the right IMAP credential and activate.

After this, every new inbound email lands in `email_intake` with full AI classification + CRM match.

### 2. Historical backfill — `Ken Inbox - Read All Back`
**Why blocked:** Modifying n8n workflows even inactive ones is gated. Activating runs ~thousands of historical emails through the AI classifier (cost event).

**You do (10 min):**
1. Open `Ken Inbox - Read All Back` in n8n UI.
2. Delete the `Done` (noOp) node.
3. Add HTTP Request node → POST → `https://sfelhasepvaoianyuvxe.supabase.co/functions/v1/email-monitor` with the body shape from `N8N_INTEGRATION.md` §3 (set `source: 'backfill'`).
4. Activate. Monitor `email_intake` row count climb.
5. (Repeat for re4lty, dosmortgage, laenan, wolfinsure inboxes once IMAP creds are added per #1.)

### 3. Deploy Ziarem Intelligence service to VPS1
**Why blocked:** SSH to root@72.62.174.114 was correctly gated (this session never received explicit auth for that target).

**You do (one command, after granting SSH permission to me OR running yourself):**
```bash
bash scripts/deploy_to_vps1.sh
```
The script: SSHs to VPS1, clones the repo into `/docker/ziarem`, copies `.env.example → .env` (you fill it once), `docker compose up -d --build`, verifies `/health`. Then point the n8n HTTP nodes at `https://ziarem-api.srv1257040.hstgr.cloud/inbox/webhook/n8n` to upgrade from email-monitor → full Ziarem ingestion.

### 4. Free LLM API keys (15 min total)
Account creation is in the prohibited-actions list — you sign up.

| Provider | Free tier | Sign up |
|---|---|---|
| Google AI Studio (Gemini Flash) | 1500/day | https://aistudio.google.com/app/apikey |
| Groq (Llama 3.3 70B) | ~14400/day | https://console.groq.com |
| OpenRouter (DeepSeek-R1, etc.) | ~200/day | https://openrouter.ai/keys |
| Cloudflare Workers AI | 10K neurons/day | your existing CF account |

Drop into `/docker/ziarem/.env`. Restart `ziarem-ai-worker`. Cost cascade kicks in immediately.

---

## 📈 What this gets you in 24 hours

Once #1 (IMAP creds added in n8n UI) and #2 (Read All Back activated) are done:
- All 4 (or 5) business inboxes flowing into `email_intake` with AI classification.
- Telegram alerts for urgent emails (cancellations, payments due, mortgagee updates).
- CRM auto-stamped on every email (matched contact id + business).
- Daily digest available via `?action=digest`.

Once #3 + #4 added:
- Cost-saving LLM router replaces full-rate Anthropic on every classification.
- AI worker triages 5y of historical email overnight on free tiers.
- `/inbox/recommend-product` returns ranked Laenan/DOS products for any lead.

---

## 🧹 Open follow-ups (not urgent)

- `email_intake` field-name matching uses both n8n shapes — eventually consolidate the n8n HTTP body to send `messageId` consistently for true RFC-822 dedupe.
- `Multi-Business Master Mail Router` workflow is inactive AND missing `dosmortgage.com / laenan.com` in its domain map. Cleaner long-term to use ONE master listener vs N per-business monitors.
- Consider whether `email_intake` (current) should be migrated into `email_intelligence` (the user's newer table from recent commits) for consistency with the rest of the Ziarem stack.
