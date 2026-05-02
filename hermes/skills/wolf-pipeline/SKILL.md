---
name: wolf-pipeline
description: Use this skill when the user asks about the Wolf Surety pipeline — "what's quoting", "show me bind requests", "any open claims today", "Wolf book of business", "carriers we're appointed with", "renewal queue". Read-only views into ws_*, carriers, bind_requests, binds, renewals. Companion to client-360 (which is per-client) — this is per-stage.
---

# Wolf Surety pipeline view

The funnel:

```
ws_quote_requests           ← lead intake (raw_info, line_of_business)
  ↓ ws-quote-fanout (Skyvern)
ws_carrier_quotes           ← per-carrier quotes (premium_annual, ai_score)
  ↓ operator picks one
bind_requests               ← Pending → Approved → Submitting → Bound
  ↓ ws-bind-submit (Skyvern, hard-gated)
binds + ws_policies         ← Active book
  ↓ ws-policy-renewal (Skyvern, T-60 nightly)
renewals                    ← decision queue
  ↓ ws-claim-status (Skyvern, daily)
ws_claims                   ← service tail
```

## Stage 1 — Lead intake (last 7 days)

```sql
SELECT id, line_of_business, status, client_name, email, phone,
       property_address, premium_amount, source, created_at
FROM ws_quote_requests
WHERE created_at > now() - interval '7 days'
ORDER BY created_at DESC;
```

## Stage 2 — Quotes pulled but not yet bound

```sql
SELECT
  qr.id   AS quote_request_id,
  qr.client_name,
  qr.line_of_business,
  count(*)                      AS quotes_pulled,
  min(cq.premium_annual)        AS lowest_premium,
  max(cq.ai_score)              AS top_ai_score,
  array_agg(DISTINCT cq.carrier_name ORDER BY cq.carrier_name) AS carriers
FROM ws_quote_requests qr
JOIN ws_carrier_quotes cq ON cq.quote_request_id = qr.id
LEFT JOIN bind_requests br ON br.quote_request_id = qr.id
WHERE br.id IS NULL
  AND qr.created_at > now() - interval '30 days'
GROUP BY qr.id, qr.client_name, qr.line_of_business
ORDER BY qr.created_at DESC;
```

## Stage 3 — Bind queue (the one operators check daily)

```sql
SELECT br.id, br.lob, br.client_name, br.carrier_name,
       br.premium_annual, br.premium_monthly, br.status,
       br.bound_by, br.created_at,
       (br.status = 'Approved' AND br.bound_at IS NULL
        AND br.bound_by IS NOT NULL) AS ready_for_skyvern
FROM bind_requests br
WHERE COALESCE(br.status,'') NOT IN ('Bound','Cancelled','Failed')
ORDER BY
  (CASE br.status WHEN 'Submitting' THEN 0 WHEN 'Approved' THEN 1
                  WHEN 'Pending' THEN 2 ELSE 3 END),
  br.created_at;
```

## Stage 4 — Active book (snapshot)

```sql
SELECT line_of_business,
       count(*)                              AS policies,
       count(*) FILTER (WHERE expiration_date < now() + interval '30 days') AS expiring_30d,
       count(*) FILTER (WHERE expiration_date < now() + interval '60 days') AS expiring_60d,
       sum(premium_annual)                   AS annual_premium_total
FROM ws_policies
WHERE COALESCE(status,'Active') ILIKE 'active%'
GROUP BY line_of_business
ORDER BY annual_premium_total DESC NULLS LAST;
```

## Stage 5 — Renewals not yet decided

```sql
SELECT r.policy_number, r.line_of_business,
       r.current_premium, r.best_renewal_premium,
       r.savings_amount, r.renewal_status,
       r.expiration_date,
       (r.expiration_date - now()::date) AS days_until_expire,
       r.client_notified, r.agent_notified
FROM renewals r
WHERE r.renewal_status NOT IN ('renewed','non_renewed','lost')
  AND r.expiration_date > now()::date - interval '14 days'
ORDER BY r.expiration_date;
```

## Stage 6 — Claims service tail

```sql
SELECT cl.claim_number, cl.client_name, cl.carrier_name,
       cl.line_of_business, cl.status, cl.loss_date,
       cl.estimated_amount, cl.paid_amount,
       cl.adjuster_name, cl.adjuster_phone,
       (now()::date - cl.loss_date) AS days_since_loss
FROM ws_claims cl
WHERE lower(cl.status) NOT IN ('closed','denied','withdrawn')
ORDER BY cl.loss_date DESC;
```

## Carrier capacity (which to send next quote to)

```sql
SELECT c.id, c.name, c.short_code,
       c.appointed,
       count(DISTINCT ca.risk_factor)         AS appetite_lobs,
       round(coalesce(avg(wr.win_rate), 0)::numeric, 2)   AS avg_win_rate,
       count(DISTINCT cq.id) FILTER (
         WHERE cq.created_at > now() - interval '30 days')   AS quotes_30d,
       count(DISTINCT p.id) FILTER (
         WHERE p.bound_at > now() - interval '30 days')      AS binds_30d
FROM carriers c
LEFT JOIN carrier_appetite ca   ON ca.carrier_id = c.id
LEFT JOIN carrier_win_rates wr  ON wr.carrier_id = c.id
LEFT JOIN ws_carrier_quotes cq  ON cq.carrier_id = c.id
LEFT JOIN ws_policies p         ON p.carrier_id  = c.id
WHERE c.active = true
GROUP BY c.id, c.name, c.short_code, c.appointed
ORDER BY avg_win_rate DESC NULLS LAST, binds_30d DESC NULLS LAST;
```

## Common operator questions and which query answers them

| Question | Stage |
|---|---|
| "What's new this week?" | Stage 1 |
| "Why isn't X bound yet?" | Stage 2 (quotes) + Stage 3 (bind) |
| "Approve this bind." | Stage 3, then operator UPDATEs status='Approved' + bound_by |
| "What's our book look like?" | Stage 4 |
| "Renewals to chase?" | Stage 5 |
| "Open claims?" | Stage 6 |
| "Where to send the next quote?" | Carrier capacity |

## Hard rules

- **Read-only.** State changes go through the admin UI, never this skill.
- **`bind_requests` status moves only from operator action**, never
  automatically (except `Submitting → Bound | Failed` by ws-bind-submit
  Skyvern workflow).
- **Carrier portal credentials NEVER printed** in operator output.
- **`carriers.portal_password`** is the SMTP-of-the-insurance-world —
  never SELECT it without filter, and never include in JSON output.
- The 6 stages map 1:1 to the 6 Skyvern workflows in
  `hermes/agents/skyvern/workflows/`. If a query here doesn't return
  what's expected, check the corresponding workflow's most-recent
  `skyvern_jobs` row.
