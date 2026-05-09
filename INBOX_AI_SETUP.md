# Ziarem AI Inbox — Setup & Operation

A unified AI-driven inbox for Re4lty, DOS Mortgage, Laenan, Wolf Surety, Wolf Insurance.

What it does:
- Pulls every email from each business mailbox via IMAP (incremental + historical backfill).
- AI-triages each message: summary, intent, priority, business tag, lead-match hints, sensitive-doc flags, score delta.
- Auto-updates the CRM: matches the sender to a `leads` row, logs `crm_activities`, applies score events, tags the lead with the receiving business.
- Recommends the best Laenan/DOS product for any lead with a one-call API.
- Tiered LLM routing: prefers free providers (Ollama → Gemini API → Groq → OpenRouter → Cloudflare → Gemini CLI), falls back to paid Claude only when free quotas are exhausted. Daily $ caps are enforced in SQL.

---

## 1. Apply database migrations

The migrations are additive and safe to run on a live database.

```bash
psql "$PG_URL" -f database/schema/008_ai_inbox_engine.sql
psql "$PG_URL" -f database/schema/009_llm_cost_tracking.sql
```

Where `PG_URL` is e.g. `postgres://user:pass@host.hostinger.com:5432/ziarem?sslmode=require`.

What you get:
- `business_emails` extended (is_active, business_tag, backfill state, last sync error).
- `communications` extended (full headers, thread_key, ai_* fields, embedding, FTS).
- New tables: `email_attachments`, `lender_kb_lenders`, `lender_kb_products`, `lender_kb_scenarios`, `crm_activities`, `lead_score_events`, `llm_calls`, `llm_provider_quota`.
- Views: `v_inbox_threads`, `v_llm_provider_usage_24h`, `v_llm_savings_report`.
- Triggers: auto-touch `leads.last_contacted_at` and `lead_score` from inbound emails.
- Seeded lenders: Laenan, DOS Mortgage.

---

## 2. Configure LLM providers (free first)

Get the free keys you don't already have. Each one is independently activated — you don't need all of them, but the more you have, the more headroom against rate limits.

| Tier | Provider | Cost | Quota | Key from |
|------|----------|------|-------|----------|
| 1 | Ollama (Synology) | $0 | unlimited (local) | already running on your NAS |
| 2 | Google AI Studio  | $0 | 1500/day, 15 RPM (Gemini 2.5 Flash) | https://aistudio.google.com/app/apikey |
| 3 | Groq              | $0 | ~14400/day, 30 RPM (Llama 3.3 70B)  | https://console.groq.com |
| 4 | OpenRouter        | $0 | ~200/day combined free models       | https://openrouter.ai/keys |
| 5 | Cloudflare AI     | $0 | 10K neurons/day                     | your existing Cloudflare account |
| 6 | Gemini CLI        | $0 | (uses Google One AI Premium)        | already authenticated locally |
| 7 | Anthropic Claude  | paid | $5/day cap (Haiku + Sonnet)        | https://console.anthropic.com |

Add each key to `.env`. Restart the server.

To verify what's available right now:
```bash
curl https://your-host/inbox/cost-report?days=1 -H "X-API-Key: $API_KEY"
```

To re-rank or disable providers:
```sql
-- e.g. push paid providers to lower priority (higher number)
UPDATE llm_provider_quota SET priority = 200 WHERE provider IN ('anthropic-haiku','anthropic-sonnet');

-- e.g. raise the daily cap on Sonnet (default $5/day)
UPDATE llm_provider_quota SET daily_usd_cap = 20 WHERE provider = 'anthropic-sonnet';

-- e.g. disable a provider
UPDATE llm_provider_quota SET enabled = FALSE WHERE provider = 'gemini-cli';
```

---

## 3. Activate the 4 (or 6) businesses

```sql
-- Seed business rows if they don't exist (already done by scripts/seed_business_emails.js).
-- Then mark which ones to actively pull email for and tag them:

UPDATE business_emails SET
  is_active    = TRUE,
  business_tag = 'wolfsurety',
  imap_host    = 'imap.titan.email',  -- whatever your provider is
  email_user   = 'kenneth@wolfsurety.com',
  email_pass   = 'app-password-here',
  smtp_host    = 'smtp.titan.email'
WHERE business_name = 'Wolf Surety & Reno LLC';

-- Repeat for: 'Dos Mortgage & Laenan', 'Re4lty & Closed By Whom', 'Wolf Insurance'.

-- Verify:
SELECT id, business_name, business_tag, is_active, imap_host FROM business_emails;
```

For Gmail-backed mailboxes you'll need an [App Password](https://myaccount.google.com/apppasswords) — regular passwords won't work.

---

## 4. Historical backfill (one-time, slow)

Run on the server (background it — large mailboxes take hours):

```bash
# All active businesses, last 5 years
nohup node imap_backfill.js > backfill.log 2>&1 &

# Or one business, last 2 years
nohup node imap_backfill.js --business 3 --years 2 > backfill.log 2>&1 &

# Watch progress
tail -f backfill.log
psql "$PG_URL" -c "SELECT business_name, backfill_started_at, backfill_completed_at FROM business_emails WHERE is_active;"
```

Backfill is idempotent — safe to re-run.

---

## 5. Live sync + AI worker

Two long-running processes:

```bash
# Live IMAP sync — run on a 5-minute cron (or as a systemd timer)
*/5 * * * * cd /opt/ziarem && node imap_sync.js >> sync.log 2>&1

# AI worker — daemon that triages everything in the queue
node ai_worker.js --loop --concurrency 2 &
```

`ai_worker.js` reads each unprocessed message → calls the router (free tier first) → writes ai_summary/intent/priority/extracted → matches lead → logs `crm_activities` + `lead_score_events`.

---

## 6. Daily monitoring

```bash
# Cost report (yesterday + today, what you spent vs hypothetical Sonnet baseline)
curl https://your-host/inbox/cost-report?days=7 -H "X-API-Key: $API_KEY" | jq

# Inbox status (queue depth, businesses, sync errors)
curl https://your-host/inbox/status -H "X-API-Key: $API_KEY" | jq

# Browse threads
curl 'https://your-host/inbox/threads?limit=20' -H "X-API-Key: $API_KEY"

# Search hybrid (FTS — embeddings come online once you populate them)
curl 'https://your-host/inbox/search?q=DSCR%20720%20FICO' -H "X-API-Key: $API_KEY"
```

SQL views you can read directly:
```sql
SELECT * FROM v_llm_provider_usage_24h;     -- which providers are over cap right now
SELECT * FROM v_llm_savings_report LIMIT 7; -- daily $ saved vs Sonnet baseline
SELECT * FROM v_inbox_threads ORDER BY last_message_at DESC LIMIT 50;
```

---

## 7. Lender knowledge base (Laenan, DOS)

Insert products as you learn them — they feed `/inbox/recommend-product`.

```sql
INSERT INTO lender_kb_products
  (lender_id, name, product_type, rate_min, rate_max, ltv_max, fico_min, dti_max, occupancy, requirements_md, is_active)
VALUES (
  (SELECT id FROM lender_kb_lenders WHERE slug = 'laenan'),
  'Laenan DSCR 30Y Investor',
  'dscr',
  6.875, 8.250, 75.00, 660, 50.00,
  ARRAY['investment'],
  $$- 6 months bank statements
- DSCR ≥ 1.0 (no add-back)
- 660+ FICO, 75% LTV cap
- 30-year fixed
$$,
  TRUE
);
```

Then ask the API:
```bash
curl -X POST https://your-host/inbox/recommend-product \
  -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" \
  -d '{"lead_id": 12345}'
```

You get back: ranked products with reasons, draft email to the lead, missing-info checklist.

---

## 8. Cost ceiling

Default daily caps:
- Anthropic Haiku: $5/day
- Anthropic Sonnet: $5/day
- Anthropic Opus: $2/day, **disabled by default**

Free tiers (Ollama / Gemini API / Groq / OpenRouter / Cloudflare): $0 cap by definition; only request/RPM caps apply.

If a paid provider hits its daily cap, it's automatically excluded from the routing plan until midnight UTC. The router will keep trying free providers; if they're all also exhausted (very unusual), API calls error out with `All providers failed`.

To raise the ceiling:
```sql
UPDATE llm_provider_quota SET daily_usd_cap = 20 WHERE provider = 'anthropic-sonnet';
```

---

## 9. Schema-only drop / re-apply (for dev)

To wipe just the AI inbox additions without dropping the rest of the database:

```sql
-- careful — destroys triage data
ALTER TABLE communications
  DROP COLUMN IF EXISTS ai_processed_at,
  DROP COLUMN IF EXISTS ai_summary,
  -- ... etc (full list in 008_ai_inbox_engine.sql)
;
DROP TABLE IF EXISTS llm_calls, llm_provider_quota,
                     crm_activities, lead_score_events,
                     email_attachments,
                     lender_kb_products, lender_kb_lenders, lender_kb_scenarios CASCADE;
DROP VIEW  IF EXISTS v_inbox_threads, v_llm_provider_usage_24h, v_llm_savings_report;
```

Then re-run `008_ai_inbox_engine.sql` and `009_llm_cost_tracking.sql`.
