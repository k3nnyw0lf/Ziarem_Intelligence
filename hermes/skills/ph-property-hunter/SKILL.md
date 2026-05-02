---
name: ph-property-hunter
description: Use this skill for Property Hunter — real-estate intake, probate scouting, skip-trace, and zoning/rezoning candidate analysis. Trigger on "property hunter", "PH leads", "probate cases", "skip trace status", "rezoning candidates", "tax-delinquent properties", "near commercial corridor", "estate / heir property", "off-market intake". Read-only; the PH UI is the write surface.
---

# Property Hunter — real-estate scouting / probate / skip-trace

PH is the off-market intake engine. Currently 32 ph_api_registry rows
(31 enabled), 12 ph_templates and ph_config rows, but ph_leads /
ph_properties / ph_skip_traces / ph_deals are all empty — **the
collection layer is provisioned, the scout hasn't been turned on yet**.

The pipeline:

```
ph_properties (raw scraped)
  ↓ scoring (heir / probate / tax_delinquent / corporate / corridor)
ph_leads      (qualified prospects, with stage)
  ↓ outreach via ph_campaigns + ph_templates
ph_owners     (resolved + skip-traced)
  ↓ outbound calls / mailers
ph_deals      (acquired / wholesaled / fix-flip handed off to ff_*)
```

## Stage 1 — Scout state (is the engine running?)

```sql
SELECT
  (SELECT count(*) FROM ph_api_registry WHERE is_enabled)              AS apis_enabled,
  (SELECT count(*) FROM ph_api_registry
    WHERE is_enabled AND last_called_at > now() - interval '24 hours') AS apis_called_24h,
  (SELECT count(*) FROM ph_alerts WHERE active)                        AS alerts_active,
  (SELECT count(*) FROM ph_alerts
    WHERE active AND last_triggered > now() - interval '7 days')       AS alerts_fired_7d,
  (SELECT count(*) FROM ph_properties)                                 AS properties_total,
  (SELECT count(*) FROM ph_properties
    WHERE created_at > now() - interval '7 days')                      AS properties_added_7d,
  (SELECT count(*) FROM ph_leads)                                      AS leads_total,
  (SELECT count(*) FROM ph_skip_traces
    WHERE created_at > now() - interval '7 days')                      AS skip_traces_7d;
```

If `properties_added_7d = 0` and `apis_called_24h = 0`: the scout
isn't running. Check `ph_api_registry` for stale `last_called_at`
and the cron driver (n8n / dedicated worker) on the box.

## Stage 2 — Hot lead candidates by signal

```sql
SELECT
  count(*) FILTER (WHERE is_heir_property = true)             AS heir_property,
  count(*) FILTER (WHERE deceased_owner = true)               AS deceased_owner,
  count(*) FILTER (WHERE is_estate = true)                    AS estate,
  count(*) FILTER (WHERE multiple_heirs = true)               AS multi_heir,
  count(*) FILTER (WHERE tax_delinquent = true)               AS tax_delinquent,
  count(*) FILTER (WHERE tax_delinquent_years >= 2)           AS tax_delinquent_2plus_yrs,
  count(*) FILTER (WHERE tax_auction_date IS NOT NULL
                   AND tax_auction_date > now()::date)        AS upcoming_auction,
  count(*) FILTER (WHERE is_corporate = true)                 AS corporate_owned,
  count(*) FILTER (WHERE near_lee_blvd
                   AND distance_to_lee_blvd_miles < 1.0)      AS lee_blvd_corridor,
  count(*) FILTER (WHERE on_commercial_corridor)              AS on_commercial_corridor,
  count(*) FILTER (WHERE is_rezoning_candidate)               AS rezoning_candidate,
  count(*) FILTER (WHERE is_micro_alf_candidate)              AS micro_alf_candidate,
  count(*) FILTER (WHERE is_mega_parcel)                      AS mega_parcel,
  count(*) FILTER (WHERE is_portfolio_property)               AS portfolio_property
FROM ph_properties;
```

## Stage 3 — Top-scored leads (hottest acquisition targets)

```sql
SELECT
  l.id, l.stage, l.priority, l.score, l.score_breakdown,
  p.address, p.city, p.state, p.zip,
  p.market_total_value, p.tax_delinquent_amount,
  l.asking_price, l.offer_price, l.estimated_profit, l.estimated_roi,
  l.target_use, l.acquisition_strategy,
  l.contact_attempts, l.last_contact_at, l.next_follow_up,
  l.assigned_to
FROM ph_leads l
JOIN ph_properties p ON p.id = l.property_id
WHERE l.stage NOT IN ('rejected','dead','sold','closed','lost')
ORDER BY l.score DESC NULLS LAST, l.priority DESC
LIMIT 30;
```

## Stage 4 — Probate intake (PH's killer signal)

```sql
SELECT
  pr.case_number, pr.case_type, pr.filing_date, pr.court,
  pr.decedent_name, pr.date_of_death, pr.personal_rep_name,
  pr.personal_rep_attorney, pr.status,
  p.address, p.city, p.state, p.market_total_value,
  (SELECT count(*) FROM ph_owners o
    WHERE o.property_id = p.id AND o.skip_traced = true)  AS skip_traced_count,
  (SELECT count(*) FROM ph_owners o
    WHERE o.property_id = p.id)                            AS owners_known
FROM ph_probate_records pr
JOIN ph_properties p ON p.id = pr.property_id
WHERE pr.status NOT IN ('closed','dismissed')
ORDER BY pr.filing_date DESC
LIMIT 30;
```

## Stage 5 — Skip-trace queue (owners not yet skip-traced)

```sql
SELECT
  p.address, p.city, p.state, p.zip,
  o.full_name, o.relationship, o.is_deceased,
  o.skip_traced, o.skip_trace_source,
  o.dnc_listed, o.forewarn_verified
FROM ph_owners o
JOIN ph_properties p ON p.id = o.property_id
WHERE o.skip_traced IS NOT TRUE
  AND o.is_deceased IS NOT TRUE
ORDER BY p.market_total_value DESC NULLS LAST
LIMIT 50;
```

For each row: enqueue a `ph_skip_traces` job (operator-driven from the
PH UI; the API call to providers like BatchSkipTracing /
PropStream / DataTree happens server-side via `ph_api_registry`).

## Stage 6 — Skip-trace yield + spend

```sql
SELECT
  provider,
  count(*)                            AS traces,
  sum(phones_found)                   AS phones_found,
  sum(emails_found)                   AS emails_found,
  sum(relatives_found)                AS relatives_found,
  sum(credits_used)                   AS credits_used,
  round(sum(cost_usd)::numeric, 2)    AS total_cost_usd,
  round(avg(phones_found)::numeric,1) AS avg_phones_per_trace,
  count(*) FILTER (WHERE dnc_scrubbed) AS dnc_scrubbed
FROM ph_skip_traces
WHERE created_at > now() - interval '30 days'
GROUP BY provider
ORDER BY total_cost_usd DESC NULLS LAST;
```

## Stage 7 — Deal P&L (acquired → flipped)

```sql
SELECT d.id, d.disposition_type, d.status,
       p.address, p.city, p.state,
       d.purchase_price, d.acquisition_date,
       d.sale_price, d.disposition_date,
       d.rehab_cost, d.holding_cost,
       d.total_revenue, d.total_costs, d.net_profit, d.roi_pct
FROM ph_deals d
LEFT JOIN ph_properties p ON p.id = d.property_id
WHERE d.created_at > now() - interval '180 days'
ORDER BY d.net_profit DESC NULLS LAST;
```

## Cross-business handoff

PH `ff_deal_id` field links to Fix & Flip pipeline. PH `title_order_id`
links to Closed By Whom?. PH revenue is sliced into:

| revenue column        | Receiving business |
|-----------------------|--------------------|
| `revenue_realty`      | Re4lty Inc. (commission) |
| `revenue_title`       | Closed By Whom? (settlement fee) |
| `revenue_construction`| Fix & Flip (rehab markup) |
| `revenue_credit`      | Dispute LLC (referral) |
| `revenue_other`       | Misc / unbucketed |

## Hard rules

- **PH leads NEVER auto-call without skip-trace + DNC scrub.**
  `ph_owners.dnc_listed = true` → no outbound voice/SMS.
  `ph_skip_traces.dnc_scrubbed = false` → run the scrub before any
  outreach.
- **Probate properties are sensitive** — the personal_rep is grieving.
  Don't mass-blast; PH templates are bespoke per case.
- **`ph_properties` is the canonical raw record** — never UPDATE the
  scraped fields directly. Re-scrape and let the import_batch
  reconcile.
- **`ph_owners.is_deceased = true`** → never include in skip-trace
  queue; that owner is gone, work the heirs (`ph_owners.relationship`).
- **Tax-auction dates are time-sensitive** — properties with
  `tax_auction_date < now() + 14 days` are urgent; surface them
  daily in `daily-standup`.
- **No PII export** of `ph_owners.phone_*` / `email_*` to chat
  surfaces. Drill in only when operator explicitly asks.
