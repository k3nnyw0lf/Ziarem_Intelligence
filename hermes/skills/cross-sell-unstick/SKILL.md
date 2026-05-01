---
name: cross-sell-unstick
description: Use this skill when the user asks about stuck cross-sells, dormant pipeline, "why aren't cross-sells closing", "what's blocked", or wants to advance identified cross-sell opportunities. Surfaces opportunities that have been in 'identified' status for more than 7 days with no movement, and proposes the next concrete action per row.
---

# Cross-sell pipeline unstick

The Ziarem cross-sell pipeline runs:
`identified → outreach → quote_pulled → closed | lost`.

Live snapshot at the time this skill was authored: 15 opportunities, all
at `identified`, none progressed. That's the symptom this skill exists
to fix.

## Find stuck rows

```sql
SELECT id, client_id, client_name,
       missing_lobs,
       estimated_annual_premium,
       estimated_commission,
       priority,
       detection_reason,
       (now() - created_at)::text AS age,
       created_at
FROM public.cross_sell_opportunities
WHERE status = 'identified'
  AND created_at < now() - interval '7 days'
ORDER BY estimated_annual_premium DESC NULLS LAST, priority DESC;
```

## Recommend next action per row

For each stuck row, the right next step depends on `missing_lobs`:

| missing_lob keyword | Next action |
|---|---|
| `auto`              | Auto quote — `auto_marketing_sequences` cron + Twilio outreach |
| `home` / `homeowner`| Wolf Surety — enqueue `skyvern_jobs (workflow='ws-quote-fanout', payload->client_id)` |
| `life`              | Life — partner referral via `partners` + n8n webhook |
| `health`            | Health — `health_quote_activity` workflow |
| `flood` / `umbrella`| Wolf Surety carrier appetite check (`carrier_appetite` table) |

Move the row to `outreach` once you've actually fired the action:

```sql
UPDATE public.cross_sell_opportunities
SET status = 'outreach', updated_at = now()
WHERE id = $opp_id;
```

## Bulk unstick (operator-driven)

```sql
-- Dry run: see what would move
SELECT id, client_name, missing_lobs, estimated_annual_premium
FROM public.cross_sell_opportunities
WHERE status = 'identified'
  AND created_at < now() - interval '14 days'
  AND priority >= 5
ORDER BY estimated_annual_premium DESC NULLS LAST
LIMIT 10;
```

Confirm with the operator before running the UPDATE in chat. **Never
auto-bulk-update from a chat surface** — use the admin UI or run from
the CLI explicitly.

## Hard rules

- Don't move a row to `outreach` without firing a real outreach event
  (email send, call, Skyvern job). A status flip without action is
  worse than no flip.
- Don't double-enqueue: check `skyvern_jobs` for an existing Pending row
  for the same `client_id` + workflow before inserting.
- Closing a row requires `status = 'closed'` AND `quote_request_id` set
  to the converted quote.
