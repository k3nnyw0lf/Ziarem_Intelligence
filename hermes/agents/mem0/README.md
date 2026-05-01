# Mem0 — durable per-customer memory

Hermes' built-in memory is per-agent-session. Mem0 is **per-customer**
across email + WhatsApp + voice + Slack. When a Re4lty lead from 6
months ago calls back, Vapi/Hermes know who they are without you
re-feeding context.

## Global service

In `hermes/agents/docker-compose.yml`, bound to **8080**, backed by its
own pgvector Postgres in the `mem0-postgres` service (separate from your
Supabase project — Mem0 owns its data).

```bash
curl http://localhost:8080/health
```

## Bridge to Ziarem schema

Mem0 stores facts keyed by `user_id`. Map to your existing identifiers
(do NOT duplicate data — only point):

| Surface         | Mem0 user_id                         | Source table          |
| --------------- | ------------------------------------ | --------------------- |
| Voice (Vapi)    | `vapi:<from_phone>`                  | `calls.lead_id`       |
| Email           | `email:<address>`                    | `vault_emails.from_email` |
| WhatsApp        | `wa:<wa_jid>`                        | `vault_wa_contacts.jid` |
| Slack DM        | `slack:<user_id>`                    | `profiles.slack_id`   |
| Telegram        | `tg:<chat_id>`                       | `vault_telegram_config.chat_id` |
| CRM lookup      | `lead:<leads.id>`                    | `leads.id`            |

A short Postgres view in your Supabase project unifies them so Hermes
can resolve any surface to a single Mem0 user_id:

```sql
CREATE OR REPLACE VIEW v_customer_identities AS
SELECT 'lead:'    || id::text     AS mem0_user_id, id::text AS lead_id FROM leads
UNION ALL
SELECT 'email:'   || from_email   AS mem0_user_id, NULL              FROM vault_emails
UNION ALL
SELECT 'wa:'      || jid          AS mem0_user_id, NULL              FROM vault_wa_contacts
UNION ALL
SELECT 'tg:'      || chat_id::text AS mem0_user_id, NULL             FROM vault_telegram_config;
```

Then create a small alias table to merge identities once you confirm
two surfaces are the same person:

```sql
CREATE TABLE IF NOT EXISTS mem0_identity_aliases (
  primary_id text NOT NULL,
  alias_id   text NOT NULL,
  confidence numeric NOT NULL,
  source     text,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (primary_id, alias_id)
);
```

Hermes treats `mem0_identity_aliases` as a UNION-FIND table when it
loads memory.

## Hard rules

- Don't write PII into Mem0 that doesn't already live in Supabase. The
  source-of-truth is still your CRM.
- Set a TTL on memories that contain dates / quotes (insurance quotes go
  stale in 30 days; mortgage rates in 1 day).
- Never expose Mem0's port publicly. Only Hermes (and other internal
  agents) should reach it.
