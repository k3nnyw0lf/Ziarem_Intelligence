---
name: marketing-fire
description: Use this skill when the user wants to ACTUALLY SEND a marketing campaign (not diagnose), "fire the campaign", "send the X email", "blast Y", "activate the drip", "kick off marketing". Companion to marketing-revive (which diagnoses why nothing is sending). Surfaces the highest-priority dormant campaign + the exact omni_sender command + safety checks. Operator runs the command; this skill never sends directly.
---

# Marketing fire — actually send the dormant campaigns

`marketing-revive` diagnoses ("why isn't email going out?"). This skill
acts ("here's the campaign to send and the exact command").

## 1. Pick the highest-priority dormant campaign

```sql
WITH ranked AS (
  SELECT
    'vault'                       AS surface,
    id, name,
    total_recipients              AS recipients,
    status,
    created_at,
    -- score: bigger = send first (large recipient list, oldest draft, scheduled)
    (COALESCE(total_recipients, 0)
       + EXTRACT(epoch FROM (now() - created_at))/86400
       + CASE status WHEN 'scheduled' THEN 1000
                     WHEN 'draft'     THEN  100
                     ELSE 0 END) AS score
  FROM vault_email_campaigns
  WHERE status IN ('draft','scheduled')
  UNION ALL
  SELECT
    'marketing'                   AS surface,
    id::text, name,
    recipient_count               AS recipients,
    status,
    created_at,
    (COALESCE(recipient_count, 0)
       + EXTRACT(epoch FROM (now() - created_at))/86400
       + CASE status WHEN 'active' THEN 1000
                     WHEN 'draft'  THEN  100
                     ELSE 0 END) AS score
  FROM marketing_campaigns
  WHERE status IN ('draft','active')
)
SELECT * FROM ranked
ORDER BY score DESC NULLS LAST
LIMIT 5;
```

The top row is what you fire next. If `recipients` looks suspicious
(0, very large, or doesn't match the expected segment), STOP and
hand back to the operator — never blast a list with unknown size.

## 2. Pre-flight safety checks

Before firing, verify:

```sql
-- A. At least one active sender with capacity
SELECT count(*) AS active_senders_with_room
FROM vault_email_senders
WHERE is_active
  AND COALESCE(sent_today, 0) < daily_limit;
```

```sql
-- B. The campaign has a sender_id wired (vault_email_campaigns only)
SELECT id, name, sender_id, total_recipients
FROM vault_email_campaigns
WHERE id = $campaign_id
  AND sender_id IS NOT NULL;
```

```sql
-- C. Suppression list is in place (anyone unsubscribed is honored)
SELECT count(*) AS suppression_size FROM vault_email_suppression;
-- If suppression_size = 0 and recipients > 100 → STOP. Likely a wipe;
-- ask operator to confirm before sending into a list with no DNC.
```

```sql
-- D. The TCPA / consent gate (for any SMS-bearing campaign)
SELECT count(*) FILTER (WHERE sms_consent IS NOT TRUE) AS recipients_without_sms_consent
FROM contacts c
WHERE c.id IN (SELECT contact_id FROM vault_email_sends WHERE campaign_id = $campaign_id);
-- For an SMS campaign this MUST be 0. For email-only, ignore.
```

## 3. The fire command (operator runs on the box)

For **`vault_email_campaigns`** (the Vault dashboard's parallel surface):

```bash
# On the host where omni_sender.js lives (Synology / VPS):
node /path/to/omni_sender.js --campaign-id <campaign_uuid> --dry-run
# Review the output. If counts and a sample look right:
node /path/to/omni_sender.js --campaign-id <campaign_uuid> --confirm
```

For **`marketing_campaigns`** (the older surface):

```bash
# Activate the row (operator action, via admin UI ideally):
UPDATE marketing_campaigns
SET status = 'active', send_at = now()
WHERE id = $marketing_campaign_id;

# Then the cron-driven sender picks it up. Verify:
SELECT * FROM cron.job WHERE jobname ILIKE '%marketing%' OR jobname ILIKE '%omni%';
```

## 4. Watch the send

Once firing, monitor every 60s:

```sql
SELECT
  status,
  sent_count, total_recipients,
  round(100.0 * sent_count / NULLIF(total_recipients, 0), 1) AS pct_done,
  bounced_count, complained_count,
  send_rate AS per_minute,
  started_at, completed_at
FROM vault_email_campaigns
WHERE id = $campaign_id;
```

If `bounced_count > 5%` of `sent_count`: **STOP IMMEDIATELY**. Pause
the send (admin UI), verify the sender's reputation, fix the list.
Continuing past 5% bounce will burn the sender for weeks.

## 5. Post-send

Always log to `marketing_log` (or notes column on the campaign) what
was sent, when, and to which segment — operators look at this when
the next campaign comes up.

```sql
UPDATE vault_email_campaigns
SET notes = COALESCE(notes,'') ||
            E'\n[' || to_char(now(),'YYYY-MM-DD HH24:MI') || '] ' ||
            'Fired by marketing-fire skill. Operator: ' || $operator_name
WHERE id = $campaign_id;
```

## Hard rules

- **This skill NEVER sends.** It surfaces the campaign, runs the
  pre-flight checks, prints the operator's command. The actual send
  happens via `omni_sender.js` on the host, NOT from chat.
- **Never** activate a campaign and send blast in the same step.
  `--dry-run` first, ALWAYS.
- **Never** auto-fire from a chat surface (Telegram / Slack). The
  operator must paste the command into a terminal — that's the
  audit boundary.
- **TCPA / DNC respected** — if `vault_email_suppression` is empty
  and `total_recipients > 100`, STOP. Likely a wiped suppression
  list; restore from backup or confirm with operator.
- **Bounce rate threshold**: pause at 5%. No exceptions. A sender's
  reputation costs weeks to rebuild.
- **Bilingual**: if the campaign segment includes Spanish-preferred
  contacts, verify the campaign has both `body_html` (EN) AND a
  Spanish variant in `body_text` or a sister row. Mono-language
  blast to mixed list is wasteful.
