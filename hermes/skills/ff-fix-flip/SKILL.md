---
name: ff-fix-flip
description: Use this skill for Fix & Flip — wholesale-source scanning, deal scoring (ARV / 70% rule / rehab estimate), comp analysis, wholesaler relationship management. Trigger on "fix and flip", "FF deals", "wholesaler list", "70% rule", "ARV", "what's hot in F&F", "rehab analysis", "scan log". Read-only. The disposition end of Property Hunter (`ph_leads.ff_deal_id` links the two).
---

# Fix & Flip — wholesale + deal-scoring pipeline

```
ff_wholesalers (sources)
    ↓ scanned by ff_scan_log
ff_listings (raw, per source)
    ↓ joined to property data
ff_properties + ff_comps (canonical + market)
    ↓ scored by ARV / 70% rule
ff_deals (scored / risk-flagged)
    ↓ negotiate / close
acquired (handoff to ph_deals or held in ff_deals.status='closed')
```

## Stage 1 — Source scan health

```sql
SELECT
  w.name, w.source_type, w.counties_served, w.active,
  w.deals_submitted, w.deals_closed,
  round(100.0 * w.deals_closed / NULLIF(w.deals_submitted,0), 1) AS close_rate_pct,
  w.avg_response_time_hrs,
  w.last_contacted,
  ( SELECT scanned_at FROM ff_scan_log WHERE source_id::text = w.id::text
    ORDER BY scanned_at DESC LIMIT 1 ) AS last_scanned,
  ( SELECT count(*) FROM ff_scan_log WHERE source_id::text = w.id::text
    AND scanned_at > now() - interval '7 days' ) AS scans_7d
FROM ff_wholesalers w
WHERE w.active = true
ORDER BY w.deals_closed DESC NULLS LAST;
```

## Stage 2 — Top deals (highest score, viable risk)

```sql
SELECT
  d.id, d.status, d.deal_score, d.risk_level,
  p.address, p.city, p.zip,
  p.beds, p.baths, p.sqft, p.year_built, p.condition,
  d.purchase_price,
  d.arv,
  d.rehab_cost,
  d.estimated_profit,
  d.roi_pct,
  d.cash_on_cash,
  d.seventy_pct_rule_max,
  -- 70% rule: max offer = 0.7 × ARV - rehab. Are we within budget?
  CASE WHEN d.purchase_price <= d.seventy_pct_rule_max
       THEN 'within_70pct'
       ELSE 'over_70pct' END AS rule_check,
  d.flood_zone, d.flood_insurance_required, d.hurricane_risk
FROM ff_deals d
JOIN ff_properties p ON p.id = d.property_id
WHERE d.status NOT IN ('rejected','dead','sold','closed','passed')
ORDER BY d.deal_score DESC NULLS LAST
LIMIT 20;
```

## Stage 3 — Comp analysis for one deal (sanity-check ARV)

```sql
SELECT
  d.id AS deal_id,
  p.address AS subject_address,
  p.sqft AS subject_sqft,
  c.comp_address, c.distance_miles,
  c.sale_price, c.sale_date, c.sqft AS comp_sqft,
  c.price_per_sqft, c.condition,
  -- Subject ARV vs comp implied
  d.arv,
  round(((d.arv / NULLIF(p.sqft,0)) - c.price_per_sqft)::numeric, 2)
    AS arv_vs_comp_diff_psf
FROM ff_deals d
JOIN ff_properties p ON p.id = d.property_id
JOIN ff_comps      c ON c.property_id = p.id
WHERE d.id = $deal_id
ORDER BY c.distance_miles ASC, c.sale_date DESC
LIMIT 8;
```

If `arv_vs_comp_diff_psf > 20`: ARV is optimistic (you'd be selling
above market). Flag for human review before submitting an offer.

## Stage 4 — Risk-stacked deals (high score but high risk)

```sql
SELECT
  d.id, p.address, d.deal_score, d.risk_level, d.risk_factors,
  d.flood_zone, d.flood_insurance_required, d.hurricane_risk,
  d.annual_tax, d.annual_insurance,
  d.purchase_price, d.arv, d.estimated_profit
FROM ff_deals d
JOIN ff_properties p ON p.id = d.property_id
WHERE d.status NOT IN ('rejected','dead','sold','closed')
  AND d.deal_score > 70
  AND lower(coalesce(d.risk_level,'')) IN ('high','severe')
ORDER BY d.deal_score DESC;
```

These are the "looks great on paper but watch the flood zone" deals.

## Stage 5 — Activity / follow-up queue

```sql
SELECT
  a.id, a.activity_type, a.description, a.due_date,
  d.id AS deal_id,
  p.address,
  w.name AS wholesaler,
  (now()::date - a.created_at::date) AS age_days
FROM ff_activities a
LEFT JOIN ff_deals       d ON d.id = a.deal_id
LEFT JOIN ff_properties  p ON p.id = a.property_id
LEFT JOIN ff_wholesalers w ON w.id = a.wholesaler_id
WHERE a.completed_at IS NULL
  AND (a.due_date IS NULL OR a.due_date <= now()::date + interval '7 days')
ORDER BY a.due_date NULLS LAST, a.created_at;
```

## Stage 6 — Cross-business handoff (FF → PH, FF → CBW, FF → DM)

```sql
-- FF deals that closed and should now flow to PH (rehab tracking)
-- or CBW (title) or DM (refi after flip)
SELECT
  d.id, d.status, p.address,
  d.purchase_price, d.arv, d.rehab_cost,
  -- Was this from a PH lead?
  ( SELECT id FROM ph_leads WHERE ff_deal_id = d.id ) AS ph_lead_id,
  -- Title pulled?
  p.parcel_id
FROM ff_deals d
JOIN ff_properties p ON p.id = d.property_id
WHERE d.status IN ('closed','sold','assigned')
  AND d.updated_at > now() - interval '30 days'
ORDER BY d.updated_at DESC;
```

## Hard rules

- **70% rule is the floor, not the target.** A deal at exactly 0.7 × ARV
  has zero margin — flag anything inside 5% of the ceiling for review.
- **Flood zone matters.** Florida zones AE/VE require flood insurance,
  which kills cash-flow on hold-and-flip deals. Surface `flood_zone`
  + `flood_insurance_required` in every deal output.
- **Wholesaler relationships are reputational.** `ff_wholesalers.rating`
  + `avg_response_time_hrs` matter — a 24h-response wholesaler beats a
  3-day one even if the comp deal is slightly worse.
- **Comps must be < 6 months old AND < 1 mile.** Older or farther =
  noise. ARV from those comps is fiction.
- **Never call a wholesaler's seller direct** — that's how you lose
  the wholesaler relationship. Only contact through the wholesaler.
- **Property Hunter (PH) is the cross-sell upstream**. When a PH lead
  becomes an acquisition, set `ph_leads.ff_deal_id` to link it back.
