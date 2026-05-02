---
name: vault-deals
description: Use this skill when the user asks about the Vault central pipeline — "vault deals", "what's in the multi-business pipeline", "show me CRM activity", "deals by business / by stage", or any cross-business view of vault_loans (which spans mortgage, credit-repair, commercial, insurance via `business` + `service_type` columns). Read-only. The Vault row links to dm_loans (`dm_loan_id`) and ws_policies (`ws_policy_id_link`) — this skill is the operator-facing view of the linkage.
---

# Vault — central deal pipeline (multi-business)

`vault_loans` is the hub. Each row carries:
- `business` (which Ziarem business owns the deal)
- `service_type` / `sub_service` (mortgage / credit-repair / commercial / insurance / …)
- `stage` + `stage_entered_at` (current pipeline position)
- `dm_loan_id` / `ws_policy_id_link` (cross-business links)
- `cross_sell_from` (back-pointer to which deal originated the cross-sell)
- `linked_deals` (sibling vault_loans rows — one client, multiple deals)

## 1. Pipeline by business + stage

```sql
SELECT
  business,
  service_type,
  stage,
  count(*)                                AS deals,
  round(avg(EXTRACT(epoch FROM (now() - stage_entered_at))/86400)::numeric, 1)
                                          AS avg_days_in_stage,
  sum(loan_amount)                        AS total_amount,
  count(*) FILTER (WHERE dm_loan_id IS NOT NULL)
                                          AS dm_linked,
  count(*) FILTER (WHERE ws_policy_id_link IS NOT NULL)
                                          AS ws_linked,
  count(*) FILTER (WHERE cross_sell_from IS NOT NULL)
                                          AS came_from_xsell
FROM vault_loans
WHERE created_at > now() - interval '180 days'
GROUP BY business, service_type, stage
ORDER BY business, service_type, stage;
```

## 2. Stalled deals (in-stage > 21 days)

```sql
SELECT id, first_name, last_name, business, service_type, stage,
       loan_amount, lender, loan_officer,
       (now()::date - stage_entered_at::date) AS days_stuck,
       notes
FROM vault_loans
WHERE stage NOT IN ('funded','closed','declined','withdrawn','cancelled')
  AND stage_entered_at < now() - interval '21 days'
ORDER BY stage_entered_at ASC
LIMIT 50;
```

## 3. Cross-sell origination (which deals came from which)

```sql
SELECT
  v.id,
  v.business           AS new_business,
  v.service_type,
  v.stage              AS new_stage,
  v.loan_amount,
  src.business         AS origin_business,
  src.service_type     AS origin_service,
  src.stage            AS origin_stage,
  v.created_at         AS new_created
FROM vault_loans v
LEFT JOIN vault_loans src ON src.id = v.cross_sell_from
WHERE v.cross_sell_from IS NOT NULL
  AND v.created_at > now() - interval '90 days'
ORDER BY v.created_at DESC;
```

## 4. Multi-deal clients (the same person on >1 deal)

```sql
SELECT
  lower(email)                 AS email,
  count(DISTINCT id)           AS deals,
  array_agg(DISTINCT business) AS businesses,
  array_agg(DISTINCT stage)    AS stages,
  sum(loan_amount)             AS combined_amount
FROM vault_loans
WHERE NULLIF(email,'') IS NOT NULL
GROUP BY lower(email)
HAVING count(DISTINCT id) > 1
ORDER BY deals DESC, combined_amount DESC NULLS LAST
LIMIT 30;
```

These are the **highest-LTV clients** — already buying multiple
products. Operators should prioritize keeping them happy.

## 5. Document completion lag (deals waiting on borrower docs)

```sql
SELECT id, first_name, last_name, business, stage,
       doc_completion_pct, loan_officer,
       (now()::date - created_at::date) AS days_open
FROM vault_loans
WHERE stage NOT IN ('funded','closed','declined','withdrawn')
  AND COALESCE(doc_completion_pct, 0) < 80
  AND created_at < now() - interval '7 days'
ORDER BY doc_completion_pct ASC NULLS FIRST,
         created_at ASC
LIMIT 50;
```

## 6. Insurance handoff status (vault_loans → ws_policies)

```sql
SELECT
  count(*) FILTER (WHERE insurance_status = 'bound')             AS bound,
  count(*) FILTER (WHERE insurance_status = 'pending')           AS pending,
  count(*) FILTER (WHERE insurance_status IS NULL
                   AND closing_date < now() + interval '45 days'
                   AND stage NOT IN ('declined','withdrawn'))    AS missing_with_close_soon,
  count(*) FILTER (WHERE ws_policy_id_link IS NOT NULL)          AS already_linked
FROM vault_loans
WHERE service_type ILIKE '%mortgage%'
  AND created_at > now() - interval '180 days';
```

The `missing_with_close_soon` row is a Wolf Surety auto-cross-sell
opportunity. Pair with `fn_detect_dm_cross_sells()` for DM-side
detection — Vault side needs its own equivalent (see "follow-up"
below).

## 7. Credit repair pipeline (vault_credit_repair_clients)

```sql
SELECT status, count(*),
       round(avg(score_tu)::numeric, 0) AS avg_tu,
       round(avg(score_exp)::numeric, 0) AS avg_exp,
       round(avg(goal_score - score_tu)::numeric, 0) AS avg_gap,
       sum(monthly_fee) AS mrr
FROM vault_credit_repair_clients
WHERE COALESCE(status,'') NOT IN ('graduated','cancelled')
GROUP BY status
ORDER BY count(*) DESC;
```

## Hard rules

- **Read-only.** Status changes happen through Vault's own admin UI.
- **`vault_loans.ssn_masked` and `vault_credit_repair_clients.ssn_last4`
  are the only allowed views of SSN.** Never SELECT a column literally
  named `ssn` (raw) — that column doesn't exist on these tables, but
  if it appears via a future migration, refuse.
- **`commission_amount` / `referral_fee` / `profit`** — operator-only.
  Never include in client-visible output.
- **Linked-deals UNION.** A client with 3 deals shouldn't be listed as
  3 prospects. Always dedup by `lower(email)` or `phone` before
  showing operator counts.
- A vault_loans row with `cross_sell_from` set is the result of a
  prior fan-out — don't re-cross-sell from it (would loop). The
  `re4lty-cross-sell` skill checks this.

## Follow-up (not yet built, parked)

`fn_detect_vault_cross_sells()` — equivalent of `fn_detect_dm_cross_sells`
but operating on `vault_loans.insurance_status IS NULL` rows. Same
strict-email-match guard; same NOT EXISTS dedup. File an OpenHands
issue to build it.
