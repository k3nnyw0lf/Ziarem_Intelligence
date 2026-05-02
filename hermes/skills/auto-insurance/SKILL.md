---
name: auto-insurance
description: Use this skill for the Auto Insurance vertical — vehicle quotes, drip sequences, renewals, SR-22 filings. Trigger on "auto quote", "auto policy", "vehicle insurance", "VIN lookup", "auto renewal queue", "SR-22", "telematics", "auto leads". Read-only view of auto_leads / auto_policies / auto_renewal_queue / auto_risk_profiles / auto_marketing_sequences.
---

# Auto Insurance vertical

Sister to the Wolf Surety home/commercial pipeline (`ws_*`) but
auto-specific schema. The `auto_renewal_queue` is a VIEW (not a table)
that consolidates upcoming renewals by `days_until_expiry`.

## Stage 1 — Lead intake (last 14 days)

```sql
SELECT id, source, source_detail, full_name, email, phone,
       vehicle_year, vehicle_make, vehicle_model,
       current_carrier, current_premium, policy_expiration,
       state_code, zip_code, status, language_pref,
       created_at
FROM auto_leads
WHERE created_at > now() - interval '14 days'
ORDER BY created_at DESC;
```

## Stage 2 — Risk profile completeness (quote-readiness)

```sql
SELECT rp.id, rp.client_id, rp.vin,
       rp.year, rp.make, rp.model,
       rp.usage, rp.annual_mileage, rp.garaging_zip,
       rp.primary_driver_dob, rp.years_licensed,
       rp.accidents_3yr, rp.violations_3yr, rp.claims_3yr,
       rp.sr22_required,
       -- Quote-readiness scorecard
       (CASE WHEN rp.vin            IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN rp.annual_mileage IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN rp.garaging_zip   IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN rp.primary_driver_dob IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN rp.years_licensed IS NOT NULL THEN 1 ELSE 0 END
       ) AS readiness_score
FROM auto_risk_profiles rp
ORDER BY readiness_score ASC, rp.created_at DESC
LIMIT 30;
```

`readiness_score < 4` = quote will fail or be inaccurate. Don't pull
quotes from carriers until the profile is complete.

## Stage 3 — Active book

```sql
SELECT line_of_business,
       count(*)                                                 AS policies,
       count(*) FILTER (WHERE expiration_date < now() + interval '30 days') AS expiring_30d,
       sum(premium_annual)                                      AS annual_premium_total,
       count(*) FILTER (WHERE sr22 = true)                      AS sr22_filings
FROM auto_policies
WHERE expiration_date >= now()::date
GROUP BY line_of_business;
```

## Stage 4 — Renewal queue (the auto_renewal_queue VIEW)

```sql
SELECT policy_id, full_name, policy_number, carrier_name,
       premium_annual, expiration_date, days_until_expiry,
       renewal_status, action_needed, preferred_contact
FROM auto_renewal_queue
WHERE days_until_expiry <= 60
ORDER BY days_until_expiry ASC;
```

## Stage 5 — Drip sequences (marketing automation)

```sql
SELECT name, trigger_event, lob, is_active,
       jsonb_array_length(coalesce(steps,'[]'::jsonb)) AS step_count,
       updated_at
FROM auto_marketing_sequences
ORDER BY trigger_event, lob;
```

If `is_active = true` but no `auto_leads` arriving in 30 days for that
trigger_event: the upstream lead source is dry, not the sequence.

## Stage 6 — SR-22 filings (DOI-required)

```sql
SELECT p.policy_number, p.carrier_name,
       rp.primary_driver_dob,
       p.effective_date, p.expiration_date,
       p.client_id
FROM auto_policies p
LEFT JOIN auto_risk_profiles rp ON rp.client_id = p.client_id
WHERE p.sr22 = true
ORDER BY p.expiration_date ASC;
```

SR-22 filings lapse → license suspended. These need 24h-attention
when expiring.

## Hard rules

- **VIN lookup is canonical.** A `make/model/year` quote without VIN
  is a guess; carriers will rerate at bind. Always pull VIN from the
  applicant.
- **SR-22 expiry = license risk.** Surface `sr22 = true` policies
  with expiration < 30d in `daily-standup` blockers.
- **Garaging ZIP drives rating, not mailing address.** Don't substitute
  one for the other.
- **Annual mileage tier matters.** ≤5k / 5k-7.5k / 7.5k-10k / 10k+
  are different rate brackets. Default-to-12k is overpriced.
- **Multi-vehicle discount** kicks in at 2+ vehicles per household.
  Run `auto_risk_profiles` lookup by `client_id` before quoting a
  single car — the household may have more.
- **Telematics** consent (`monitor_via` etc) is per-state. Florida
  yes; California limited. Don't push UBI in restricted states.
