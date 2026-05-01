---
name: mem0-resolve
description: Use this skill to convert any incoming surface identifier (phone, email, WhatsApp jid, Telegram chat_id, Slack user_id, lead row) into the canonical Mem0 user_id BEFORE you load or write memory. Returns one stable id even when the same person reaches you across multiple channels. Trigger on every inbound event from Vapi, IMAP, the WhatsApp bridge, the Telegram bot, or before any `mem0.search` / `mem0.add` call.
---

# Mem0 identity resolution

The Ziarem `v_customer_identities` view exposes one row per known
surface, keyed by `mem0_user_id` (e.g. `lead:42`, `tg:123456789`,
`email:owner@example.com`). The `mem0_identity_aliases` table merges
ids that we've confirmed belong to the same person.

## Resolve one surface

```sql
WITH start AS (
  SELECT mem0_user_id
  FROM v_customer_identities
  WHERE surface = $surface AND surface_id = $surface_id
  LIMIT 1
),
walk AS (
  SELECT mem0_user_id AS id FROM start
  UNION
  SELECT primary_id FROM mem0_identity_aliases
   WHERE alias_id IN (SELECT id FROM walk)
  UNION
  SELECT alias_id   FROM mem0_identity_aliases
   WHERE primary_id IN (SELECT id FROM walk)
)
SELECT id AS mem0_user_id
FROM walk
ORDER BY length(id), id      -- shortest stable id wins
LIMIT 1;
```

Inputs:
- `surface ∈ {lead, telegram, email, wa, slack, vapi}`
- `surface_id` — the raw identifier from the inbound event.

Output: one `mem0_user_id` string. If the surface has never been seen,
return `NULL` and emit a `surface:unknown` event so the curator can
decide whether to create a fresh identity.

## Merge rule (when you discover two ids belong to the same person)

```sql
INSERT INTO mem0_identity_aliases (primary_id, alias_id, confidence, source)
VALUES ($shorter_id, $longer_id, $confidence, $source)
ON CONFLICT DO NOTHING;
```

- `primary_id` = the shorter / older / lead-style id.
- `confidence` ∈ [0, 1]. ≥ 0.9 = phone or email match. 0.6–0.9 = name +
  fragment match (ask before merging in chat). < 0.6 = don't merge.
- `source` ∈ {phone_match, email_match, manual, voice_id, ...}.

## Hard rules

- **Never write to Mem0 without resolving first.** Per-surface
  fragments produce duplicate memories that pollute future answers.
- **Never auto-merge below 0.9 confidence.** Surface the candidate to
  the user via Hermes and let them confirm.
- **Never expose `mem0_user_id` in user-facing output.** It's an
  internal key.
- **Aliases are append-only.** Don't delete rows; if a merge was wrong,
  insert into `mem0_identity_unmerges` so the audit trail holds:
  ```sql
  INSERT INTO mem0_identity_unmerges (primary_id, alias_id, reason, source)
  VALUES ($primary_id, $alias_id, $reason, $source);
  ```
  Resolution code must filter aliases against the unmerges table:
  ```sql
  SELECT a.*
  FROM mem0_identity_aliases a
  WHERE NOT EXISTS (
    SELECT 1 FROM mem0_identity_unmerges u
    WHERE u.primary_id = a.primary_id AND u.alias_id = a.alias_id
  );
  ```
