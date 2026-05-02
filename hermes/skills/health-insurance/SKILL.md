---
name: health-insurance
description: Use this skill for the Health Insurance vertical — ACA / Medicare / Medicaid quoting via HealthSherpa + CMS APIs. Trigger on "health quotes", "ACA enrollment", "Medicare quote", "HealthSherpa status", "subsidy estimate", "metal tier", "OEP / SEP". Read-only view of health_quotes / health_policies / health_eligibility / health_enrollment_transactions.
---

# Health Insurance — ACA / Medicare / Medicaid

`health_*` is the most-tables-but-empty vertical I've seen — schema is
provisioned for a full ACA agency workflow but no live policies yet.
The 4 webhook URLs in `health_api_config` (n8n_eligibility_webhook,
n8n_aca_webhook, n8n_medicare_webhook, n8n_medicaid_webhook) suggest
n8n is the orchestrator.

## Stage 1 — API config + integration health

```sql
SELECT
  CASE WHEN cms_api_key IS NOT NULL AND cms_api_key != '' THEN 'set' ELSE 'EMPTY' END           AS cms,
  CASE WHEN health_sherpa_api_key IS NOT NULL AND health_sherpa_api_key != '' THEN 'set' ELSE 'EMPTY' END AS healthsherpa,
  CASE WHEN medicare_api_key IS NOT NULL AND medicare_api_key != '' THEN 'set' ELSE 'EMPTY' END AS medicare,
  n8n_base_url,
  n8n_eligibility_webhook IS NOT NULL AS has_eligibility_webhook,
  n8n_aca_webhook         IS NOT NULL AS has_aca_webhook,
  n8n_medicare_webhook    IS NOT NULL AS has_medicare_webhook,
  n8n_medicaid_webhook    IS NOT NULL AS has_medicaid_webhook,
  updated_at
FROM health_api_config;
```

**NEVER select the actual key columns into chat output.** Use the
`'set' / 'EMPTY'` flag form above.

## Stage 2 — Quote pipeline (active)

```sql
SELECT q.id, q.applicant_name, q.applicant_age, q.zip_code, q.state,
       q.household_size, q.household_income,
       q.carrier_name, q.selected_plan_id, q.cms_plan_year,
       q.status, q.expires_at, q.created_at,
       qe.subsidy_amount, qe.insurance_type
FROM health_quotes q
LEFT JOIN health_quotes_extended qe ON qe.id = q.id
WHERE lower(coalesce(q.status,'')) NOT IN ('expired','enrolled','dropped')
ORDER BY q.created_at DESC
LIMIT 30;
```

## Stage 3 — Eligibility lookups (subsidy / Medicaid / CHIP)

```sql
SELECT h.id AS household_id, h.state, h.zip_code,
       h.household_size, h.household_income, h.fpl_percentage,
       e.medicaid_eligible, e.chip_eligible,
       e.aca_eligible, e.aptc_eligible, e.csr_eligible,
       e.aptc_amount, e.csr_level,
       e.effective_date, e.expires_at
FROM health_households h
LEFT JOIN health_eligibility e ON e.household_id = h.id
ORDER BY h.created_at DESC
LIMIT 30;
```

## Stage 4 — Enrollment transactions in flight

```sql
SELECT et.id, et.quote_id, et.plan_id,
       et.enrollment_method, et.source_system,
       et.confirmation_number, et.status,
       et.enrollment_initiated_at, et.enrollment_completed_at,
       (et.enrollment_completed_at - et.enrollment_initiated_at) AS duration
FROM health_enrollment_transactions et
WHERE et.enrollment_completed_at IS NULL
ORDER BY et.enrollment_initiated_at DESC;
```

## Stage 5 — Policies + webhook reconciliation

```sql
SELECT p.id, p.policy_number, p.carrier_name, p.plan_name,
       p.status, p.status_updated_at,
       p.effective_date, p.termination_date,
       p.premium_amount, p.monthly_subsidy,
       p.last_webhook_event, p.last_webhook_at
FROM health_policies p
WHERE lower(coalesce(p.status,'')) NOT IN ('terminated','cancelled')
ORDER BY p.created_at DESC
LIMIT 30;
```

## Stage 6 — Webhook log (HealthSherpa / CMS callbacks)

```sql
SELECT source, event_type, status,
       count(*)                                AS events,
       count(*) FILTER (WHERE error_message IS NOT NULL) AS errors,
       max(created_at)                         AS last_event_at
FROM health_webhook_log
WHERE created_at > now() - interval '7 days'
GROUP BY source, event_type, status
ORDER BY last_event_at DESC;
```

## Hard rules

- **OEP vs SEP.** Open Enrollment Period is Nov 1 – Jan 15. Outside
  OEP, only Special Enrollment Period (life event) is valid. Quotes
  outside OEP MUST have an `sep_reason` set in `health_risk_profiles`.
- **Subsidy values are CMS-derived, not estimates.** Never compute a
  custom AAPC / CSR — read from `health_eligibility.aptc_amount` /
  `csr_level` only.
- **HealthSherpa deeplinks expire.** `health_quotes.healthsherpa_deeplink_url`
  has a window (typically 30 days). Don't surface stale deeplinks.
- **HIPAA-adjacent data** (health_status, smoker_status, current_medications,
  preferred_doctors) — never include in cross-app queries or chat
  output unless operator explicitly asks for the specific applicant.
- **Medicare + Medicaid require separate licensing.** A general health
  agent may not be appointed to both — check `agent_id` against the
  agent's pro_licenses before quoting.
