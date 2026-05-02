---
name: cbw-orders
description: Use this skill when the user asks about Closed By Whom? title-settlement orders — "what's closing this week", "CBW pipeline", "title orders", "closing schedule", "approvals waiting", "automation queue". Read-only views into cbw_orders by stage, with the CBW automation/approval queue and commission roll-up. Companion to wolf-pipeline / dm-pipeline.
---

# Closed By Whom? — title settlement pipeline

CBW is the title side. Each closing earns ~$1,500 flat. Orders flow:

```
opened → contract_in → title_search → cleared → ready_to_close
       → closing → recorded → policy_issued → disbursed → closed
```

Per-order milestones live in `cbw_orders.milestone` + boolean flags
(`auto_checks_passed`, `deposit_verified`, `title_clear`, `docs_complete`,
`ready_to_close`, `funding_verified`, `cpl_issued`).

## Stage 1 — Closing this week / next week

```sql
SELECT order_number, file_number, transaction_type, service_type,
       buyer_name, seller_name, property_address,
       buyer_agent, seller_agent, lender_name, closer,
       sale_price, loan_amount,
       closing_date, closing_time, closing_location,
       milestone, ready_to_close
FROM cbw_orders
WHERE closing_date BETWEEN now()::date AND (now() + interval '14 days')::date
ORDER BY closing_date, closing_time;
```

## Stage 2 — Stuck orders (closing past, not closed)

```sql
SELECT order_number, file_number, buyer_name, property_address,
       closing_date, status, milestone,
       (now()::date - closing_date::date) AS days_past_due,
       title_clear, docs_complete, deposit_verified, ready_to_close,
       payoff_status, hoa_docs_status
FROM cbw_orders
WHERE closing_date < now()::date
  AND lower(coalesce(status,'')) NOT IN ('closed','disbursed','cancelled','withdrawn')
ORDER BY closing_date ASC;
```

## Stage 3 — Approvals waiting (operator action)

```sql
SELECT a.id, a.order_id,
       o.order_number, o.buyer_name, o.property_address,
       a.approval_type, a.description, a.status, a.assigned_to,
       a.created_at,
       (now() - a.created_at) AS waiting_for
FROM cbw_approvals a
JOIN cbw_orders     o ON o.id = a.order_id
WHERE a.status = 'pending'
ORDER BY a.created_at ASC;
```

## Stage 4 — Automation queue (Skyvern / agents picking up)

```sql
SELECT q.id, q.automation_type, q.trigger_source, q.status,
       q.requires_approval, q.approved_by,
       o.order_number, o.buyer_name,
       q.retry_count, q.error_message,
       q.created_at, q.processed_at
FROM cbw_automation_queue q
LEFT JOIN cbw_orders o ON o.id = q.order_id
WHERE q.status NOT IN ('completed','cancelled')
ORDER BY q.created_at DESC;
```

## Stage 5 — Auto-checks passing rate (does the AI agent verify rows?)

```sql
SELECT
  count(*) FILTER (WHERE auto_checks_total > 0)               AS orders_with_checks,
  count(*) FILTER (WHERE auto_checks_passed = auto_checks_total
                   AND auto_checks_total > 0)                 AS fully_passing,
  round(100.0 * count(*) FILTER (
    WHERE auto_checks_passed = auto_checks_total AND auto_checks_total > 0)
    / NULLIF(count(*) FILTER (WHERE auto_checks_total > 0), 0), 1) AS pct_passing
FROM cbw_orders
WHERE created_at > now() - interval '30 days';
```

## Stage 6 — Closing slots (capacity for next 14 days)

```sql
SELECT closer_id,
       slot_date,
       count(*) FILTER (WHERE is_available)                                AS available,
       count(*) FILTER (WHERE booked_order_id IS NOT NULL)                 AS booked,
       count(*)                                                            AS total
FROM cbw_closing_slots
WHERE slot_date BETWEEN now()::date AND (now() + interval '14 days')::date
GROUP BY closer_id, slot_date
ORDER BY slot_date, closer_id;
```

## Stage 7 — Revenue / commission roll-up

```sql
SELECT
  date_trunc('week', co.created_at)::date AS week,
  count(DISTINCT co.id)                   AS orders,
  sum(c.title_premium)                    AS title_premium_total,
  sum(c.settlement_fee)                   AS settlement_fee_total,
  sum(c.gross_revenue)                    AS gross_revenue,
  sum(c.agent_commission_amt)             AS agents_paid,
  sum(c.agency_retained)                  AS agency_kept
FROM cbw_orders     co
LEFT JOIN cbw_commissions c ON c.order_id = co.id
WHERE co.created_at > now() - interval '90 days'
GROUP BY week
ORDER BY week DESC;
```

## Stage 8 — Cross-sell offers (CBW already runs an internal cross-sell)

```sql
SELECT co.order_number, co.buyer_name,
       cs.business, cs.offer_type, cs.status,
       cs.sent_at, cs.converted_at, cs.revenue
FROM cbw_crosssell_offers cs
JOIN cbw_orders co ON co.id = cs.order_id
WHERE cs.created_at > now() - interval '60 days'
ORDER BY cs.created_at DESC
LIMIT 50;
```

This table is the existing CBW cross-sell engine. Don't duplicate
into `cross_sell_opportunities` for a CBW order — check this first.

## Hard rules

- **Read-only.** Approvals get decided through the admin UI / closer's
  chat. This skill only surfaces the queue.
- **No SSN/TIN exposure.** `cbw_1099s.seller_tin_encrypted` is exactly
  that — encrypted. Never decrypt or expose.
- **`cbw_orders.client_token`** is for buyer/seller portal access —
  never print to chat. If a row needs portal access, generate a fresh
  link via the closer's UI, not by extracting the token.
- **`cbw_companies.tax_id`** also never printed.
- The CBW system has its own internal cross-sell engine
  (`cbw_crosssell_offers`). When fanning out cross-sells from a Re4lty
  trigger that involves a CBW order, write to
  `cbw_crosssell_offers` (which the order's own UI handles), NOT to
  `cross_sell_opportunities` — to avoid double-counting.
- **`cbw_realtors`** has 2k rows and **`cbw_lenders`** has 744. Default
  to LIMIT 50 on any query that surfaces these — operators want a
  scannable list, not a dump.
