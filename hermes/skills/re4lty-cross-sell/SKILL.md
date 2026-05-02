---
name: re4lty-cross-sell
description: Use this skill when a Re4lty offer flips to accepted/under-contract, when the user asks "fan out cross-sells for offer X", "what cross-sells should this listing get", "did the cross-sells fire", or wants to push a Re4lty under-contract row through the partner network (Dos Mortgage, Wolf Surety, Closed By Whom?). Idempotent — never inserts a duplicate cross_sell_opportunities row for the same client + missing_lob.
---

# Re4lty cross-sell fan-out (anchor automation)

Re4lty is the anchor in `apps.yaml` (anchor=true). Per `ziarem-soul.md`,
when a Re4lty deal moves to **accepted / under_contract**, the system
should create cross-sell opportunities for:

- **Dos Mortgage** — mortgage origination ($1,500-$3,000+ revenue)
- **Wolf Surety** — homeowners + title insurance ($600 flat per policy)
- **Closed By Whom?** — title settlement ($1,500 flat)
- **Dispute LLC** — only if buyer credit is flagged

This skill is the operator surface for that fan-out.

## Find offers that should have fired

```sql
SELECT
  o.id           AS offer_id,
  o.lead_id,
  o.offer_price,
  o.financing_type,
  o.closing_date,
  o.status       AS offer_status,
  l.title        AS listing_title,
  l.address      AS property_address,
  l.city, l.state,
  l.bedrooms, l.bathrooms, l.sqft,
  -- Has the cross-sell already been created for any partner?
  (SELECT count(*) FROM cross_sell_opportunities cso
     WHERE cso.client_id = o.lead_id::uuid) AS existing_xsells
FROM re4lty_offers o
JOIN re4lty_listings l ON l.id = o.listing_id
WHERE lower(o.status) IN ('accepted','under_contract','pending_close')
ORDER BY o.closing_date NULLS LAST, o.created_at DESC
LIMIT 50;
```

Rows where `existing_xsells = 0` are the ones that haven't been
fanned-out yet.

## Insert cross-sell rows (idempotent)

```sql
-- For one offer_id, create cross-sell rows for the 3 standard partners.
-- ON CONFLICT skipped because cross_sell_opportunities lacks a unique
-- index across (client_id, missing_lobs) — we dedupe with NOT EXISTS.
WITH ctx AS (
  SELECT o.lead_id::uuid       AS client_id,
         coalesce(c.full_name,
                  l.address || ' ' || l.city) AS client_name,
         o.offer_price,
         l.address || ', ' || l.city || ' ' || l.state AS property_full
  FROM re4lty_offers o
  JOIN re4lty_listings l ON l.id = o.listing_id
  LEFT JOIN clients c   ON c.id = o.lead_id::uuid
  WHERE o.id = $offer_id
)
INSERT INTO cross_sell_opportunities
  (client_id, client_name, current_lobs, missing_lobs,
   estimated_annual_premium, estimated_commission,
   priority, status, auto_detected, detection_reason)
SELECT ctx.client_id, ctx.client_name,
       ARRAY['real_estate']::text[],
       ARRAY[lob]::text[],
       est_premium, est_commission, prio,
       'identified', true,
       'Re4lty offer ' || $offer_id || ' (' || ctx.property_full ||
       ', $' || ctx.offer_price || '). Auto-fanout via re4lty-cross-sell.'
FROM ctx,
     (VALUES
        ('mortgage',         3000.0, 1500.0, 9),
        ('homeowners_ins',   2400.0,  600.0, 8),
        ('title_settlement',  500.0, 1500.0, 7)
     ) AS t(lob, est_premium, est_commission, prio)
WHERE NOT EXISTS (
  SELECT 1 FROM cross_sell_opportunities cs
  WHERE cs.client_id = ctx.client_id
    AND ARRAY[t.lob] && cs.missing_lobs
);
```

## Trigger downstream automation

After inserting cross-sell rows, the next action depends on which LOB:

| missing_lob keyword          | Downstream                                                |
| ---------------------------- | --------------------------------------------------------- |
| `mortgage`                   | dm_loans intake (n8n webhook OR `omni_sender` to LO)     |
| `homeowners_ins` / `flood`   | enqueue `skyvern_jobs (workflow='ws-quote-fanout')`       |
| `title_settlement`           | cbw_orders intake (POST to n8n_webhook_onboarding_url)    |
| `auto`                       | auto_marketing_sequences cron picks up                    |

The skill stops at status='identified'. Operator advances to 'outreach'
once the downstream actually fires (see `cross-sell-unstick`).

## Hard rules

- **Never auto-fanout for accepted offers older than 30 days** — likely
  already handled manually. Surface them, don't insert.
- **Never insert duplicate cross-sell rows** — the NOT EXISTS clause
  above must stay.
- **`re4lty_offers.lead_id` is text** — cast to `::uuid` matching
  `clients.id` / `cross_sell_opportunities.client_id`.
- **RENO LLC** is a different anchor (per SOUL): triggers Wolf Surety
  ONLY (no DM, no CBW). Add a `business` discriminator before fanning
  out blanket rows.
- All five new cross-sells per offer would be wrong — there's no Lyco
  Tax integration yet. Stick to the 3-partner set above until Lyco
  connector lands.
