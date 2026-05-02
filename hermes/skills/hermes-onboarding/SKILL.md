---
name: hermes-onboarding
description: Use this skill when a NEW lead arrives from any surface (Vapi call, web form, Telegram inbound, partner referral) and you need to drive it through the standard onboarding pipeline — identity merge → cross-sell detection → outreach assignment. Triggered by "new lead", "onboard X", "lead from Y came in", "process this contact", or webhook events. Composes mem0-resolve + cross-sell-unstick + marketing-fire under one umbrella.
---

# Hermes onboarding — new-lead arrival pipeline

When a lead lands anywhere (Vapi inbound, apply form, Telegram bot,
partner referral, etc.), Hermes runs this sequence:

```
1. Land    → write to leads (or appropriate per-business table)
2. Resolve → check mem0_identity_aliases for an existing primary_id
3. Detect  → run cross-sell detection (which products do they need?)
4. Route   → assign to omni_sender bucket OR enqueue Vapi callback
5. Notify  → POST to N8N_WEBHOOK_ONBOARDING_URL if anchor flow
6. Log     → ai_chat_sessions / vault_lead_sessions for audit
```

## Step 1 — Land the lead (per source)

| Source                       | Insert target                          |
| ---------------------------- | -------------------------------------- |
| Vapi inbound                 | `leads` + `vault_calls`                |
| Apply form                   | `leads` (status='new')                 |
| Telegram bot                 | `vault_telegram_messages` + `leads`    |
| Partner referral             | `leads` + `vault_loans` (with `referral_partner` set) |
| Re4lty offer accepted        | `re4lty_offers` (already there) — go straight to step 3 |
| DM loan submitted            | `dm_loans` (already there) — go straight to step 3 |

## Step 2 — Identity resolve (use the `mem0-resolve` skill)

```sql
-- Find existing aliases for this lead's surface_id
WITH new_id AS (
  SELECT 'lead:' || $lead_id::text AS surface_id,
         lower($email)              AS email,
         regexp_replace($phone,'[^0-9]','','g') AS phone_digits
)
-- Has anyone else with the same email/phone been merged before?
SELECT primary_id, alias_id, confidence, source
FROM mem0_identity_aliases
WHERE alias_id IN (
  SELECT 'email:' || email   FROM new_id WHERE email IS NOT NULL
  UNION ALL
  SELECT 'phone:' || phone_digits FROM new_id WHERE phone_digits != '')
  OR alias_id IN (
  SELECT 'lead:' || c.id::text FROM clients c, new_id
  WHERE lower(c.email) = new_id.email);
```

If a `primary_id` returns: this is the same person, merge under the
existing primary_id (write a new row to `mem0_identity_aliases`).
If nothing returns: this is a new identity; create one with
`primary_id = 'lead:' || lead_id`.

## Step 3 — Cross-sell detection

```sql
-- Find products the client doesn't yet have, given what they DO have
WITH client AS (SELECT $client_id::uuid AS id),
     existing AS (
       SELECT array_agg(DISTINCT lob) AS lobs FROM (
         SELECT 'mortgage' AS lob FROM dm_loans dm, client
           WHERE lower(dm.client_email) = lower((SELECT email FROM clients WHERE id = client.id))
         UNION ALL
         SELECT 'homeowners_ins' FROM ws_policies WHERE client_id = (SELECT id FROM client)
         UNION ALL
         SELECT lower(line_of_business) FROM ws_policies WHERE client_id = (SELECT id FROM client)
       ) x
     )
SELECT
  ARRAY['mortgage','homeowners_ins','title_settlement','auto_ins','life_ins','credit_repair']
  -- Subtract whatever they already have
  -- (PG array subtraction via unnest+except)
  AS all_lobs,
  existing.lobs                                        AS has_lobs
FROM existing;
```

Insert one `cross_sell_opportunities` row per missing LOB **using the
`re4lty-cross-sell` skill's NOT EXISTS guard**.

## Step 4 — Outreach assignment

Map `lead_scorer.js` tags → SMTP identity bucket:

| Lead tag                 | Sender bucket | Routing                                      |
| ------------------------ | ------------- | -------------------------------------------- |
| `Wolf_Trade`             | `WOLF`        | Add to `vault_email_campaigns` segment 'wolf' |
| `Distressed_Property`    | `RE4LTY`      | Add to Re4lty distressed segment             |
| `Credit_Repair_Urgent`   | `DISPUTE`     | Vault credit-repair intake                   |
| `Lyco_HighNetWorth`      | `LYCO`        | Lyco Tax referral                            |
| `Lyco_Business`          | `LYCO`        | Lyco Tax business referral                   |
| (default mortgage lead)  | `DOS`         | DM intake                                    |

If `priority >= 8` AND lead is voice-eligible (phone consent on file):
**enqueue a Vapi callback** instead of (or in addition to) email:

```sql
INSERT INTO ws_outbound_queue
  (client_id, phone_number, department, purpose, priority,
   client_name, scheduled_at, lead_timezone)
SELECT $client_id, $phone, 'sales', 'New lead callback', 90,
       $name, now() + interval '5 minutes', 'America/New_York'
WHERE EXISTS (
  SELECT 1 FROM contacts c
  WHERE c.id = $client_id AND c.sms_consent IS NOT FALSE);
```

(Reminder: `ws_outbound_queue` is the **voice-call queue**, not Skyvern.
Different table from `skyvern_jobs`.)

## Step 5 — Anchor onboarding webhook

If the lead came from an anchor (Re4lty `under_contract` / RENO LLC),
POST to n8n. The URL comes from `credentials` row
`n8n - Workflow Automation (VPS)` → `base_url` (or env
`N8N_WEBHOOK_ONBOARDING_URL`):

```
POST $url
{
  "anchor": "Re4lty",
  "lead_id": "...",
  "client_id": "...",
  "preferred_language": "EN",
  "missing_lobs": ["mortgage","homeowners_ins","title_settlement"],
  "estimated_revenue": 5100
}
```

## Step 6 — Audit log

```sql
INSERT INTO ai_chat_sessions
  (session_id, user_id, agent_role, model, summary, created_at)
VALUES
  (gen_random_uuid()::text, $client_id::text,
   'hermes-onboarding', 'hermes',
   format('Onboarded %s from %s. Missing LOBs: %s. Routed to %s.',
          $name, $source, $missing_lobs::text, $bucket),
   now());
```

## Hard rules

- **Bilingual default.** Detect from `contacts.preferred_language` or
  inbound message language. EN if uncertain.
- **TCPA / DNC.** Before any voice or SMS, check
  `vault_email_suppression` AND `contacts.sms_consent`. If `sms_consent
  IS FALSE`, no SMS — email or web only.
- **Identity merging never auto-deletes** an alias. Wrong merges go to
  `mem0_identity_unmerges` (audit append-only).
- **Cross-sell creation idempotent.** Always use the NOT EXISTS guard
  from `re4lty-cross-sell` — one row per `(client_id, missing_lobs)`.
- **Anchor webhook fire-and-forget.** Don't block onboarding on the
  webhook reply. If n8n is down, the lead still lands; n8n catches up
  on its next poll.
- **No raw SMTP sends from this skill.** Outbound only via
  `omni_sender.js` (bulk) or the Hermes email gateway (1:1).
