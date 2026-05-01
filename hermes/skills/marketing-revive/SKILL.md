---
name: marketing-revive
description: Use this skill when the user asks about dormant email senders, "why aren't campaigns going out", "revive marketing", "send the campaign", or marketing engagement metrics. Surfaces dormant senders + scheduled campaigns that haven't fired and proposes the unstick path.
---

# Marketing revive

The Ziarem marketing engine = `omni_sender.js` (Node) reading from:
- `marketing_campaigns` — campaign definitions (status: draft|active|sent)
- `vault_email_campaigns` — Vault dashboard's parallel surface
- `vault_email_senders` — SMTP rotation pool (27 configured)
- `email_tracking` — pixel + click events
- `vault_email_suppression` — DNC list

Snapshot at skill-author time: 27 senders ALL `is_active`, 0 sends in
30 days, 1 campaign in `active` status, 5 in `sent`. Either the sender
cron isn't running or no campaign has been activated.

## Diagnose

```sql
-- 1. Is any campaign actually queued to send?
SELECT id, name, status, send_at, sent_at, recipient_count, drip_steps
FROM public.marketing_campaigns
WHERE status IN ('active','draft','scheduled')
ORDER BY send_at NULLS LAST, created_at;

SELECT id, name, status, started_at, completed_at,
       sent_count, total_recipients,
       (sent_count::float / NULLIF(total_recipients,0))::numeric(4,2) AS progress
FROM public.vault_email_campaigns
WHERE status IN ('draft','scheduled','sending')
ORDER BY started_at NULLS LAST;

-- 2. Are senders actually sending?
SELECT id, email, provider, daily_limit, sent_today, last_sent_at,
       reputation_score
FROM public.vault_email_senders
WHERE is_active
  AND (last_sent_at IS NULL OR last_sent_at < current_date)
ORDER BY reputation_score DESC NULLS LAST;

-- 3. Is the cron firing?
SELECT * FROM cron.job WHERE jobname ILIKE '%omni%' OR jobname ILIKE '%campaign%';
```

## Common causes (in order of likelihood)

1. **`omni_sender.js` cron isn't running.** The Node process fires
   only when invoked. Check:
   - `crontab -l` on the Synology / VPS for `node omni_sender.js`
   - Hermes cron: `hermes cron list | grep marketing`
2. **Sender SMTP creds are missing.** `vault_email_senders.smtp_pass`
   must be set; admin UI populates from the credentials catalog (see
   `hermes-keys` skill).
3. **No active campaign.** A campaign in `draft` never sends; flip to
   `active` (and set `send_at` to a future timestamp) via the admin UI.
4. **Suppression list collapse.** If `vault_email_suppression` was
   nuked, every recipient was unsubscribed — that's a manual restore.
5. **Reputation score < threshold.** `vault_email_senders.reputation_score`
   below the warmup floor → omni_sender skips the row.

## Unstick the simplest case (single campaign)

```bash
# On the box where omni_sender lives:
node omni_sender.js <campaign_id>
# Watch logs for SMTP auth errors → if any, populate sender.smtp_pass
# from credentials catalog and rerun.
```

## Hard rules

- **Never** activate a campaign or send-blast from a chat surface.
  Operator must use the admin UI; this skill diagnoses, doesn't act.
- **Always** dry-run a campaign by sending to a `@ziarem.com` test
  list first. The omni-SMTP rotation can burn deliverability if a
  Provider-Bounce rate spikes early.
- TCPA / DNC: confirm `email_suppression` is honored before any
  reactivation. If the list is empty, restore from a backup or pause
  outbound.
