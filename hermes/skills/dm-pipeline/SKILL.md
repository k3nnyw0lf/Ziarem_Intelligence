---
name: dm-pipeline
description: Use this skill when the user asks about the Dos Mortgage pipeline — "what loans are funding this week", "DM pipeline", "what's submitted", "where's the money", "loan officer dashboard". Read-only views into dm_loans by stage. Companion to wolf-pipeline (insurance) and cbw-orders (title).
---

# Dos Mortgage pipeline

DM is the second-largest revenue surface (456 loans, $1500-3000+ per
funded loan via 2.75% × loan_amount). Status flows roughly:

```
new / submitted → processing → underwriting → clear_to_close → funded → closed
                                                              ↘ cancelled / withdrawn
```

`dm_loans` columns to know:

- Identity: `loan_id, borrower_name, co_borrower_name, client_email, client_phone`
- Money: `loan_amount, purchase_price, total_comp, total_comp_lender, profit, comp_paid, comp_paid_date, processing_fee, referral_fee, rf_paid`
- Pipeline: `loan_status, submission_date, lock_expiration, lock_active, exp_lock, closing_date, doc_*`
- Cross-business: `hoi_company, hoi_policy_number, hoi_premium, ws_policy_id` (insurance handoff), `title_company, title_order_number` (title handoff), `realtor` (real-estate handoff)
- Risk: `eq_score, tr_score, ex_score, credit_status, dti_front, dti_back, ltv, qm_status`

## Stage 1 — New / submitted (last 14 days)

```sql
SELECT loan_id, borrower_name, loan_type, lender,
       loan_amount, purchase_price, submission_date,
       loan_status, doc_income, doc_ids, doc_assets, doc_contract
FROM dm_loans
WHERE lower(loan_status) IN ('new','submitted','registered')
  AND submission_date > now() - interval '14 days'
ORDER BY submission_date DESC;
```

## Stage 2 — Processing / underwriting (the active book)

```sql
SELECT loan_id, borrower_name, loan_status,
       lender, lo, loan_amount,
       lock_expiration, lock_active,
       (lock_expiration::date - now()::date) AS days_until_lock_expires,
       qm_status, fin_type
FROM dm_loans
WHERE lower(loan_status) IN ('processing','submitted','underwriting','approved')
ORDER BY lock_expiration ASC NULLS LAST;
```

## Stage 3 — Clear to close (this week's funders)

```sql
SELECT loan_id, borrower_name, lender, lo,
       loan_amount, purchase_price,
       closing_date, closer,
       hoi_company, hoi_policy_number, hoi_effective,
       title_company, title_order_number,
       coalesce(total_comp, loan_amount * 0.0275) AS expected_revenue
FROM dm_loans
WHERE lower(loan_status) IN ('clear_to_close','ctc','final_approval')
   OR (closing_date BETWEEN now() AND now() + interval '14 days')
ORDER BY closing_date ASC NULLS LAST;
```

## Stage 4 — Funded (revenue this week)

```sql
SELECT loan_id, borrower_name, lender,
       loan_amount, closing_date,
       coalesce(total_comp, loan_amount * 0.0275) AS revenue,
       comp_paid, comp_paid_date,
       (CASE WHEN comp_paid THEN 'paid' ELSE 'pending' END) AS payout_state
FROM dm_loans
WHERE lower(loan_status) = 'funded'
  AND closing_date >= date_trunc('week', now())
ORDER BY closing_date DESC;
```

## Stage 5 — Cross-business handoffs (DM → WS, DM → Title)

```sql
-- DM loans where insurance is missing — feed Wolf Surety quote intake
SELECT loan_id, borrower_name, property_address, closing_date,
       hoi_company, hoi_premium, ws_policy_id
FROM dm_loans
WHERE lower(loan_status) IN ('processing','underwriting','clear_to_close','ctc')
  AND (hoi_policy_number IS NULL OR hoi_policy_number = '')
  AND ws_policy_id IS NULL
  AND closing_date BETWEEN now() AND now() + interval '45 days'
ORDER BY closing_date;
```

```sql
-- DM loans where title is missing — feed CBW intake
SELECT loan_id, borrower_name, property_address, closing_date,
       title_company, title_order_number
FROM dm_loans
WHERE lower(loan_status) IN ('processing','underwriting','clear_to_close','ctc')
  AND (title_order_number IS NULL OR title_order_number = '')
  AND closing_date BETWEEN now() AND now() + interval '45 days'
ORDER BY closing_date;
```

These two queries are the natural feeders for the `re4lty-cross-sell`
fan-out pattern, but on the DM side. Identify rows here, INSERT into
`cross_sell_opportunities` with the appropriate `missing_lobs`.

## Stage 6 — Lock expiration warnings (rate risk)

```sql
SELECT loan_id, borrower_name, lender, rate, loan_amount,
       lock_expiration,
       (lock_expiration::date - now()::date) AS days_left
FROM dm_loans
WHERE lock_active = true
  AND lock_expiration BETWEEN now() AND now() + interval '7 days'
  AND lower(loan_status) NOT IN ('funded','closed','cancelled','withdrawn')
ORDER BY lock_expiration ASC;
```

## Stage 7 — Stalled / problem loans

```sql
SELECT loan_id, borrower_name, lender, loan_status,
       submission_date,
       (now()::date - submission_date::date) AS days_since_submission,
       credit_status, eq_score, tr_score, ex_score,
       follow_up
FROM dm_loans
WHERE lower(loan_status) IN ('processing','submitted','underwriting')
  AND submission_date < now() - interval '21 days'
ORDER BY submission_date ASC;
```

## Hard rules

- **Read-only.** All status changes go through the LO's CRM /
  Arive — never directly via this skill.
- **Commission columns sensitive.** `total_comp`, `total_comp_lender`,
  `profit`, `referral_fee`, `comp_paid` — show only when the operator
  explicitly asks for revenue. Default surfaces show
  `loan_amount + status` only.
- **Borrower PII** (full name, email, phone) is fine in lookup
  contexts. Don't include in aggregate dashboards.
- **2.75%** is the standard DM commission. If a row has `total_comp`
  set, use that exact number — don't compute. Compute fallback only
  when `total_comp IS NULL`.
- The DM ↔ WS / Title handoff queries (Stage 5) are the cross-sell
  detection layer. Run weekly; insert results into
  `cross_sell_opportunities` with `auto_detected=true,
  detection_reason='dm-pipeline:stage5'`.
