---
name: ziarem-status
description: Use this skill whenever the user asks "is everything working?", "what's running?", "show me a status / dashboard / health report", "marketing status", "AI sales status", or any cross-business operational question. Runs a single SQL audit against the live Supabase project that covers marketing (campaigns, senders, sends, tracking), AI sales (calls, leads pipeline, cross-sell), and integrations (credentials, APIs, gateways) — then reports gaps the user should act on. Trigger on: "status", "is X working", "are campaigns sending", "did the calls run today", "stuck cross-sells", "dashboard", "operational report".
---

# Ziarem live operational status

Run the audit query below, then summarize for the user with **only the
non-trivial signals** — don't list 50 zeros.

## The audit query

```sql
WITH s AS (
  SELECT 'marketing.campaigns_email'   AS surface, count(*) AS total,
         count(*) FILTER (WHERE status = 'active')                      AS active,
         count(*) FILTER (WHERE status IN ('sent','completed'))          AS done
  FROM public.vault_email_campaigns
  UNION ALL
  SELECT 'marketing.campaigns_general',  count(*),
         count(*) FILTER (WHERE status = 'active'),
         count(*) FILTER (WHERE status = 'sent')
  FROM public.marketing_campaigns
  UNION ALL
  SELECT 'marketing.senders',            count(*),
         count(*) FILTER (WHERE is_active),
         NULL
  FROM public.vault_email_senders
  UNION ALL
  SELECT 'marketing.sends_30d',
         count(*) FILTER (WHERE created_at > now() - interval '30 days'),
         count(*) FILTER (WHERE status = 'delivered'),
         count(*) FILTER (WHERE bounced_at IS NOT NULL)
  FROM public.vault_email_sends
  UNION ALL
  SELECT 'marketing.tracking_30d',
         count(*) FILTER (WHERE created_at > now() - interval '30 days'),
         count(*) FILTER (WHERE opened_at IS NOT NULL),
         count(*) FILTER (WHERE clicked_at IS NOT NULL)
  FROM public.email_tracking
  UNION ALL
  SELECT 'sales.calls_7d',
         count(*) FILTER (WHERE started_at > now() - interval '7 days'),
         count(*) FILTER (WHERE direction = 'inbound'),
         count(*) FILTER (WHERE direction = 'outbound')
  FROM public.vault_calls
  UNION ALL
  SELECT 'sales.call_log_7d',
         count(*) FILTER (WHERE date_time > now() - interval '7 days'),
         NULL, NULL
  FROM public.vault_call_log
  UNION ALL
  SELECT 'sales.ai_call_config',         count(*), NULL, NULL
  FROM public.vault_ai_call_config
  UNION ALL
  SELECT 'sales.leads_total',            count(*),
         count(*) FILTER (WHERE status = 'new'),
         count(*) FILTER (WHERE status IN ('qualified','under_contract'))
  FROM public.leads
  UNION ALL
  SELECT 'sales.cross_sell_opps',        count(*),
         count(*) FILTER (WHERE status = 'identified'),
         count(*) FILTER (WHERE status = 'closed')
  FROM public.cross_sell_opportunities
  UNION ALL
  SELECT 'integrations.credentials',     count(*), NULL, NULL FROM public.credentials
  UNION ALL
  SELECT 'integrations.apis_enabled',    count(*),
         count(*) FILTER (WHERE enabled), NULL FROM public.vault_apis
  UNION ALL
  SELECT 'integrations.api_configs',     count(*),
         count(*) FILTER (WHERE is_active), NULL FROM public.vault_api_configs
  UNION ALL
  SELECT 'comms.telegram',               count(*),
         count(*) FILTER (WHERE is_active), NULL FROM public.vault_telegram_config
  UNION ALL
  SELECT 'comms.telegram_msgs_7d',
         count(*) FILTER (WHERE created_at > now() - interval '7 days'),
         NULL, NULL
  FROM public.vault_telegram_messages
)
SELECT * FROM s ORDER BY surface;
```

## Reporting rules

1. **Headline first.** One sentence: "X surfaces healthy, Y idle, Z need attention."
2. **Group by area.** Marketing → Sales → Integrations → Comms.
3. **Surface gaps**, not noise. Skip rows where total=0 unless it's a place
   where 0 is alarming (e.g. `sales.calls_7d = 0` means no Vapi traffic
   for a week — that's worth flagging).
4. **Recommend, don't just describe.** If `marketing.campaigns_email`
   shows `draft=1, scheduled=1` but `sends_30d=0`, say "1 scheduled
   campaign hasn't sent — check `vault_email_campaigns.send_at` or the
   omni_sender cron."
5. **Status taxonomy is lowercase.** Live data uses `active|sent|draft|
   completed|scheduled|sending|new|identified|qualified|closed|delivered`,
   NOT capitalized. The earlier SOUL.md had this wrong.

## Specific health checks worth running on demand

### Stuck cross-sells (identified > 7 days, no movement)

```sql
SELECT id, client_name, missing_lobs, estimated_annual_premium,
       priority, created_at,
       (now() - created_at)::text AS age
FROM public.cross_sell_opportunities
WHERE status = 'identified'
  AND created_at < now() - interval '7 days'
ORDER BY estimated_annual_premium DESC NULLS LAST
LIMIT 20;
```

If this returns rows: the cross-sell automation is not picking up
identified opportunities. Recommend either (a) wiring n8n to flip
status to `outreach`, or (b) running `omni_sender` against them.

### Dormant senders (no send today, but `is_active`)

```sql
SELECT id, email, provider, daily_limit, sent_today, last_sent_at,
       reputation_score
FROM public.vault_email_senders
WHERE is_active
  AND (last_sent_at IS NULL OR last_sent_at < current_date)
ORDER BY reputation_score DESC NULLS LAST;
```

If 27/27 senders are dormant: SMTP path isn't being exercised.
Recommend running `node omni_sender.js <campaign_id>` to confirm
senders authenticate.

### Vapi traffic gap

```sql
SELECT date_trunc('day', started_at)::date AS day,
       count(*) AS calls,
       count(*) FILTER (WHERE direction='inbound')  AS inbound,
       count(*) FILTER (WHERE direction='outbound') AS outbound
FROM public.vault_calls
WHERE started_at > now() - interval '14 days'
GROUP BY day
ORDER BY day DESC;
```

If the table is empty for the last 14 days: AI sales floor isn't live.
Check `vault_ai_call_config.config` and the Vapi webhook on the worker.

## Hard rules

- **Never write to operational tables from this skill** — read-only audit.
- **Never expose API keys** from `credentials` / `vault_apis.api_key` /
  `vault_email_senders.smtp_pass`. Always select identifying columns
  only (id, name, provider).
- **Use lowercase status comparisons** everywhere. Past versions of the
  SOUL had Capitalized values; live data does not.
- **Don't conflate `vault_email_campaigns` with `marketing_campaigns`.**
  They're parallel surfaces (the omni-SMTP marketing engine vs. the
  Vault dashboard's campaigns). Report both.
