---
name: ziarem-revenue-desk
description: Use this skill when the user asks "how much did we make this week/month", "revenue across all businesses", "what's earned", "commission report", "revenue desk", or any question that aggregates money across Ziarem businesses. Joins revenue surfaces from Wolf Surety policies, Dos Mortgage loans, Re4lty offers, Closed By Whom orders, and Vault deals into one report. Read-only.
---

# Ziarem revenue desk — one-shot money report

Cross-app revenue aggregation. Each business has its own pipeline and
revenue model; this skill rolls them up.

## Revenue model per anchor

Per `ziarem-soul.md`:

| Partner          | Formula / source column                                  |
| ---------------- | -------------------------------------------------------- |
| Dos Mortgage     | 2.75% × `dm_loans.loan_amount` (or `total_comp` if set) |
| Wolf Surety      | $600 × bound `ws_policies` (or `ws_policies.premium_annual` × commission %) |
| Closed By Whom?  | $1,500 × closed `cbw_orders`                            |
| Re4lty Inc.      | Listing-side commission on `re4lty_offers` closed       |

## The roll-up query

```sql
-- This week, this month, and YTD across every revenue surface.
-- Counts only rows in their terminal/realized state.

WITH params AS (
  SELECT
    date_trunc('week', now())  AS wk,
    date_trunc('month', now()) AS mo,
    date_trunc('year', now())  AS yr
)
SELECT bucket, partner, period, total_revenue, deal_count
FROM (
  -- Dos Mortgage: 2.75% of loan_amount on funded loans
  SELECT
    'dm' AS partner,
    CASE
      WHEN closing_date >= params.wk THEN 'this_week'
      WHEN closing_date >= params.mo THEN 'this_month'
      WHEN closing_date >= params.yr THEN 'ytd'
    END AS period,
    sum(coalesce(total_comp, loan_amount * 0.0275)) AS total_revenue,
    count(*) AS deal_count,
    1 AS bucket
  FROM dm_loans, params
  WHERE lower(loan_status) IN ('funded','closed','clear_to_close')
    AND closing_date >= params.yr
  GROUP BY period, params.wk, params.mo, params.yr

  UNION ALL

  -- Wolf Surety: $600 flat per Active policy bound in window
  SELECT
    'ws' AS partner,
    CASE
      WHEN bound_at >= params.wk THEN 'this_week'
      WHEN bound_at >= params.mo THEN 'this_month'
      WHEN bound_at >= params.yr THEN 'ytd'
    END AS period,
    600.0 * count(*) AS total_revenue,
    count(*) AS deal_count,
    2 AS bucket
  FROM ws_policies, params
  WHERE lower(coalesce(status,'active')) = 'active'
    AND bound_at >= params.yr
  GROUP BY period, params.wk, params.mo, params.yr

  UNION ALL

  -- Re4lty: closed offers (sold price as proxy when commission % missing)
  SELECT
    're4lty' AS partner,
    CASE
      WHEN o.created_at >= params.wk THEN 'this_week'
      WHEN o.created_at >= params.mo THEN 'this_month'
      WHEN o.created_at >= params.yr THEN 'ytd'
    END AS period,
    sum(o.offer_price * 0.025) AS total_revenue,   -- 2.5% buy/list-side proxy
    count(*) AS deal_count,
    3 AS bucket
  FROM re4lty_offers o, params
  WHERE lower(o.status) IN ('accepted','closed','sold')
    AND o.created_at >= params.yr
  GROUP BY period, params.wk, params.mo, params.yr
) x
WHERE period IS NOT NULL
ORDER BY bucket, period;
```

## Pipeline-not-yet-revenue (forecast)

```sql
-- What's in motion: bind_requests Approved (about-to-bind),
-- skyvern_jobs Pending (about-to-quote), cross_sell_opportunities
-- identified (potential).

SELECT 'wolf_about_to_bind' AS bucket, count(*) AS rows,
       sum(premium_annual)  AS exposure
FROM bind_requests WHERE status = 'Approved' AND bound_at IS NULL
UNION ALL
SELECT 'wolf_quotes_in_flight', count(*),
       NULL FROM skyvern_jobs
WHERE workflow = 'ws-quote-pull' AND status = 'Pending'
UNION ALL
SELECT 'crosssell_identified', count(*),
       sum(estimated_annual_premium)
FROM cross_sell_opportunities WHERE status = 'identified'
UNION ALL
SELECT 'dm_loans_in_processing', count(*), sum(loan_amount * 0.0275)
FROM dm_loans WHERE lower(loan_status) IN ('processing','submitted','underwriting');
```

## Reporting rules

1. **Always include both realized and pipeline numbers** — operators
   want to know what's banked vs. what's coming.
2. **Round to whole dollars in chat output.** Cents are noise.
3. **Note the formula assumption** when reporting Re4lty/DM revenue
   (we use 2.5% / 2.75% defaults; actual deal-by-deal commissions live
   in `total_comp` / per-listing fields).
4. **Don't include Cancelled / Failed / Withdrawn rows.** Filter at
   query level.

## Hard rules

- **Read-only.** Never UPDATE / INSERT from this skill.
- **Never expose `dm_loans.loan_amount` rows individually unless asked**
   — too easy to leak in a screenshot. Default output is aggregate only.
- If a number looks wrong, dump the raw SQL and let the operator check
  manually. Don't silently correct.
