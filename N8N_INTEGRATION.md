# n8n → Ziarem Inbox Integration

How to wire your existing n8n inbox workflows into the Ziarem AI inbox.

**State as observed on 2026-05-09:**
- `Wolf - Email Monitor` (active) → posts to Supabase edge function `email-monitor`. Field-name mismatch (`from_email` vs `from`) means rows land with NULL content. ~10 rows in 3 months.
- `Wolf - Email Monitor (Daine)` (active) → same broken target.
- `Ken Inbox - Read All Back` (inactive) → ends in noOp, never saves.
- `Multi-Business Master Mail Router` (inactive) → has domain map but missing `dosmortgage.com`, `laenan.com`, `re4lty.com` is mapped though.
- DOS Mortgage / Laenan / Re4lty: no live monitor.

The plan below points all of them at one Ziarem endpoint:

```
POST https://your-ziarem-host/inbox/webhook/n8n
Header: X-Webhook-Secret: <N8N_WEBHOOK_SECRET from .env>
```

Ziarem normalizes both shapes (`from_email/body_text/...` AND `from/text/...`), dedupes on RFC-822 Message-ID, inserts to `communications`, enqueues for AI triage via the cost-saving cascade (Ollama → Gemini → Groq → ... → Claude), and updates the CRM.

---

## 0. Prerequisites

In your Ziarem `.env`:
```
N8N_WEBHOOK_SECRET=pick-a-long-random-string
```
Restart the API server.

In Postgres (one row per business — already partly done by `seed_business_emails.js`):
```sql
UPDATE business_emails SET business_tag = 'wolfsurety',     is_active = TRUE WHERE business_name = 'Wolf Surety & Reno LLC';
UPDATE business_emails SET business_tag = 'wolfinsurance',  is_active = TRUE WHERE business_name = 'Wolf Insurance';
UPDATE business_emails SET business_tag = 'dosmortgage',    is_active = TRUE WHERE business_name LIKE 'Dos Mortgage%';
UPDATE business_emails SET business_tag = 'laenan',         is_active = TRUE WHERE business_name LIKE '%Laenan%';
UPDATE business_emails SET business_tag = 're4lty',         is_active = TRUE WHERE business_name LIKE 'Re4lty%';
```

(`Dos Mortgage & Laenan` is one row in `config/businesses.js` — split into two if you want them as separate business_ids; for now one row tagged `dosmortgage` is fine.)

---

## 1. Patch the active monitor — `Wolf - Email Monitor` (id `KOX_wF_OulVzFlbuTH8MD`)

In the n8n editor, open this workflow and edit the **HTTP Request** node:

- **URL:** change from `https://sfelhasepvaoianyuvxe.supabase.co/functions/v1/email-monitor`
  to `https://your-ziarem-host/inbox/webhook/n8n`
- **Headers:** keep `Authorization: Bearer …` if you also need it, but **add**:
  ```
  X-Webhook-Secret: <N8N_WEBHOOK_SECRET>
  ```
  (and remove the Supabase Bearer if you don't need it any more)
- **Body (JSON):** replace the existing expression with:
  ```js
  ={{ JSON.stringify({
    business_tag: 'wolfsurety',                  // hard-coded per workflow — change per inbox
    source: 'live',
    message_id: $json.messageId || $json.message_id,
    from_email: $json.from?.value?.[0]?.address || $json.from,
    from_name:  $json.from?.value?.[0]?.name    || $json.from_name,
    to_email:   $json.to?.value?.[0]?.address   || $json.to,
    subject:    $json.subject || '',
    body_text:  $json.text || $json.textPlain || '',
    body_html:  $json.html || $json.textHtml || null,
    received_at: $json.date || new Date().toISOString(),
    in_reply_to: $json.inReplyTo || null,
    references: $json.references || [],
    attachments: ($json.attachments || []).map(a => ({ filename: a.filename, content_type: a.contentType, size: a.size }))
  }) }}
  ```

Repeat for `Wolf - Email Monitor (Daine)` (id `3DLYnLGm4D9eQmIX`) using `business_tag: 'wolfinsurance'`.

---

## 2. Clone the monitor for Re4lty / DOS Mortgage / Laenan

In n8n: right-click `Wolf - Email Monitor` → **Duplicate**. Rename and edit:

| New workflow name           | IMAP creds (configure in node) | business_tag in body |
|-----------------------------|--------------------------------|----------------------|
| `Re4lty - Email Monitor`    | `hello@re4lty.com` (or whichever inbox) | `re4lty`         |
| `DOS Mortgage - Email Monitor` | mailbox at dosmortgage.com         | `dosmortgage`    |
| `Laenan - Email Monitor`    | mailbox at laenan.com               | `laenan`         |

In each: **IMAP node** → set credentials (n8n's encrypted vault — pick the right account or create new). Open a test execution to confirm the IMAP connection works. Activate the workflow.

---

## 3. Wire the historical backfill — `Ken Inbox - Read All Back` (id `4wnDpvOSK1FK9noM`)

This workflow already pulls all messages from `ken@`. It currently dead-ends at a noOp. Replace the `Done` node with an **HTTP Request** node configured the same way as in step 1, but set:

```js
business_tag: 'wolfinsurance',  // ken@ goes to Wolf Insurance per the existing tag in the code node
source: 'backfill',
```

Activate the workflow once. It'll drain through every historical email and POST each to Ziarem. The Ziarem dedupe (on RFC-822 Message-ID) makes it safe to re-run.

To replicate this for the other 3 businesses, duplicate the workflow per inbox, change the IMAP node to that mailbox, change `business_slug` and `mailbox` in the code node, and set the right `business_tag` in the HTTP body.

> **Tip:** Backfill is bandwidth-heavy. For a 5-year backfill on a 50K+ inbox, run during off-hours or split with IMAP `BEFORE/SINCE` search criteria.

---

## 4. Activate `Multi-Business Master Mail Router` (id `kFUQ7nc3qLV3aS1y`) — optional, more advanced

This workflow has the full domain → business mapping logic and per-route sub-routing. To use it as the single inbound gateway:

In the **Extract Domain & Business** code node, extend the `domainMap`:

```js
const domainMap = {
  'wolfsurety.com':       'wolfsurety',     // was 'wolf-insurance'
  'wolfinsure.com':       'wolfinsurance',  // (if you use both domains)
  'dosmortgage.com':      'dosmortgage',
  'laenan.com':           'laenan',
  're4lty.com':           're4lty',
  'closedbywhom.com':     'closed-by-whom',
  'mansionsignature.com': 'mansion-signature',
  'lycopro.com':          'lyco',
  'dsputes.com':          'dispute',
};
```

Replace each `Exec Wolf …` ExecuteWorkflow branch (or add new branches) with a single **HTTP Request** to Ziarem. Then deactivate the per-business `Wolf - Email Monitor` workflows so you only have the master listening.

(Skip this step if you prefer one workflow per business — that's also fine.)

---

## 5. Verify

After activating each new/edited workflow:

```bash
# Check that messages are landing in communications:
curl -s 'https://your-ziarem-host/inbox/status' -H "X-API-Key: $API_KEY" | jq

# Watch the AI triage queue drain (with the worker running):
node ai_worker.js --loop --concurrency 2

# After ~5 minutes you should see:
psql "$PG_URL" -c "SELECT business_id, count(*), max(sent_at) FROM communications WHERE direction='INBOUND' GROUP BY business_id;"
psql "$PG_URL" -c "SELECT count(*) FILTER (WHERE ai_processed_at IS NULL) AS pending,
                          count(*) FILTER (WHERE ai_processed_at IS NOT NULL) AS triaged FROM communications;"
```

---

## 6. Cleaning up

Once Ziarem ingestion is proven for ~24 hours:

1. **Disable the Supabase edge function** so we don't run two ingestion paths:
   ```bash
   # via Supabase MCP / dashboard
   # or just stop pointing n8n at it (already done in step 1)
   ```
2. **Optionally drop `email_intake`** (~10 rows of mostly-NULL content):
   ```sql
   -- only after you've verified everything is in communications
   DROP TABLE public.email_intake CASCADE;
   ```
3. **Optionally retire the `Wolf - Email Monitor (Daine)` duplicate** if Daine doesn't have her own separate inbox.

---

## 7. Routing through n8n's existing Claude proxy (cost note)

You have these always-on n8n proxies:

```
VAULT - Claude Proxy         (Zj9tq5t6cz50Bke7)  → /webhook/claude
VAULT - Claude Doc Proxy     (diZvOMhMxkftuKrO)
```

These currently bill at full Anthropic rates per call. The Ziarem LLM router (Tier 7+) hits Anthropic directly and tracks cost in `llm_calls`. If you'd rather have **all** Anthropic calls go through your existing n8n proxy (so you have one billing chokepoint), set in `.env`:

```
ANTHROPIC_BASE_URL=https://n8n.srv1257040.hstgr.cloud/webhook/claude
```

…and tweak `src/llm/providers/anthropic_haiku.js` / `anthropic_sonnet.js` to use that URL (small one-line edit). Lets you cap n8n-side instead of duplicating cost tracking. Most users skip this.
