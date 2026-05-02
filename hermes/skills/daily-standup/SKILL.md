---
name: daily-standup
description: Use this skill when the user asks "morning report", "what's the standup", "give me today's snapshot", "where are we", "morning briefing", or wants a one-shot summary covering yesterday's wins, today's pipeline, and today's blockers. Combines ziarem-status + ziarem-revenue-desk + cross-sell-unstick + marketing-revive into a single operator-facing brief, optimized for chat (Telegram/Slack) — short, scannable, action-oriented.
---

# Daily standup brief

The one query an operator runs at 8 AM. Combines pipeline, revenue,
blockers, and "what changed overnight" into 8-12 lines.

## The query

```sql
WITH today AS (SELECT now()::date d),
     yesterday AS (SELECT (now() - interval '1 day')::date d),
     w_start AS (SELECT date_trunc('week', now())::date d)
SELECT json_build_object(
  'as_of', now(),

  -- WINS in the last 24h
  'won_24h', json_build_object(
    'wolf_policies_bound', (
      SELECT count(*) FROM ws_policies
      WHERE bound_at >= now() - interval '24 hours'),
    'dm_loans_funded', (
      SELECT count(*) FROM dm_loans
      WHERE lower(loan_status) = 'funded'
        AND closing_date >= now() - interval '24 hours'),
    'cross_sells_closed', (
      SELECT count(*) FROM cross_sell_opportunities
      WHERE status = 'closed'
        AND updated_at >= now() - interval '24 hours'),
    'realtime_calls', (
      SELECT count(*) FROM vault_calls
      WHERE started_at >= now() - interval '24 hours')
  ),

  -- PIPELINE today (new since 24h ago)
  'new_pipeline_24h', json_build_object(
    'leads', (
      SELECT count(*) FROM leads
      WHERE created_at >= now() - interval '24 hours'),
    'quote_requests', (
      SELECT count(*) FROM ws_quote_requests
      WHERE created_at >= now() - interval '24 hours'),
    'cross_sells_identified', (
      SELECT count(*) FROM cross_sell_opportunities
      WHERE status = 'identified'
        AND created_at >= now() - interval '24 hours')
  ),

  -- BLOCKERS — things that should have moved but didn't
  'blockers', json_build_object(
    'crosssells_stuck_7d', (
      SELECT count(*) FROM cross_sell_opportunities
      WHERE status = 'identified'
        AND created_at < now() - interval '7 days'),
    'leads_unworked_7d', (
      SELECT count(*) FROM leads
      WHERE status = 'new'
        AND created_at < now() - interval '7 days'
        AND contacted_at IS NULL),
    'bind_requests_pending_approval', (
      SELECT count(*) FROM bind_requests
      WHERE status = 'Pending'
        AND created_at < now() - interval '24 hours'),
    'skyvern_jobs_failed_24h', (
      SELECT count(*) FROM skyvern_jobs
      WHERE status = 'Failed'
        AND created_at >= now() - interval '24 hours'),
    'ws_policies_expiring_30d', (
      SELECT count(*) FROM ws_policies
      WHERE COALESCE(status,'Active') ILIKE 'active%'
        AND expiration_date BETWEEN now()::date AND (now() + interval '30 days')::date
        AND id NOT IN (SELECT bind_id FROM renewals WHERE bind_id IS NOT NULL))
  ),

  -- REVENUE — week-to-date, realized only
  'wtd_revenue_estimate_usd', json_build_object(
    'dm_loans', (
      SELECT round(coalesce(sum(coalesce(total_comp, loan_amount * 0.0275)), 0)::numeric, 0)
      FROM dm_loans
      WHERE lower(loan_status) IN ('funded','closed')
        AND closing_date >= date_trunc('week', now())),
    'wolf_policies', (
      SELECT 600 * count(*) FROM ws_policies
      WHERE COALESCE(status,'Active') ILIKE 'active%'
        AND bound_at >= date_trunc('week', now())),
    're4lty_offers', (
      SELECT round(coalesce(sum(offer_price * 0.025), 0)::numeric, 0)
      FROM re4lty_offers
      WHERE lower(status) IN ('accepted','closed','sold')
        AND created_at >= date_trunc('week', now()))
  ),

  -- COMMS health
  'comms', json_build_object(
    'email_sends_24h', (
      SELECT count(*) FROM vault_email_sends
      WHERE created_at >= now() - interval '24 hours'),
    'telegram_msgs_24h', (
      SELECT count(*) FROM vault_telegram_messages
      WHERE created_at >= now() - interval '24 hours')
  )
) AS standup;
```

## Reporting format (chat-friendly)

Render the JSON above as plain text, max 12 lines, in this order:

```
☀️ Standup as of <as_of HH:MM>

✓ Won (24h): <bound> WS bind, <funded> DM funded, <closed> cross-sells, <realtime_calls> calls
+ New (24h): <leads> leads, <quote_requests> WS quotes, <cs_id> cross-sells
⚠ Blocked: <stuck> stuck cross-sells, <unworked> unworked leads, <pending> bind approvals waiting,
           <failed_jobs> Skyvern fails, <expiring> WS policies expiring 30d
$ WTD: $<dm> DM, $<ws> WS, $<re4lty> Re4lty
✉ 24h: <email> emails sent, <tg> Telegram msgs
```

If a number is 0, drop the line entirely (don't say "0 wins"). If
**Blocked** is non-zero on any item, surface the top 3 by impact and
suggest the unstick skill: "Run `cross-sell-unstick` for the 7+
identified rows older than 7d."

## Hard rules

- **Chat-mode default: no PII.** Don't list lead names, addresses, or
  client phone numbers in the chat output. Stick to counts and dollar
  amounts. Only drill in when the operator explicitly asks for the
  list.
- **Always read-only.** This skill never UPDATEs or INSERTs.
- **Time horizons are absolute, not relative.** "24h" means literal
  `now() - interval '24 hours'`, not "since last open of the chat".
- **Numbers > 0 get the leading icon; numbers = 0 drop the bullet.**
  Operators ignore zero rows in seconds; they shouldn't even appear.
