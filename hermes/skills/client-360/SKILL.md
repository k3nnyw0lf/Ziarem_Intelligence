---
name: client-360
description: Use this skill when the operator asks about a specific client by name, email, phone, or id — "tell me everything about Acme Corp", "what do we know about jane@example.com", "show me Smith's policies + loans + claims". Pulls from every relevant table across Wolf Surety, Dos Mortgage, Re4lty, calls, emails, cross-sells, and identity merges. Single read-only roll-up. Always lists outstanding follow-ups (open claims, pending bind, expiring policies) at the top.
---

# Client 360 — full picture by client_id / email / phone / name

## The lookup query

Resolve the client first, then fan out. Skill caller should pass exactly
one of `$client_id`, `$email`, `$phone`, or `$name` (LIKE).

```sql
WITH resolved AS (
  -- Pick whichever input is non-null. Returns at most a few candidates.
  SELECT id, full_name, email, phone, address, city, state, source, ezlynx_id
  FROM clients
  WHERE ($client_id IS NOT NULL AND id = $client_id::uuid)
     OR ($email     IS NOT NULL AND lower(email) = lower($email))
     OR ($phone     IS NOT NULL AND regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g')
                                  = regexp_replace($phone, '[^0-9]', '', 'g'))
     OR ($name      IS NOT NULL AND full_name ILIKE '%' || $name || '%')
  LIMIT 5
)
SELECT * FROM resolved;
```

If `resolved` returns more than 1 row, surface them and ask the
operator to pick before fanning out.

## Fan-out (single chosen client_id)

```sql
SELECT json_build_object(
  'identity', (
    SELECT json_build_object(
      'id', id, 'full_name', full_name, 'email', email,
      'phone', phone, 'city', city, 'state', state,
      'source', source, 'ezlynx_id', ezlynx_id, 'created_at', created_at)
    FROM clients WHERE id = $client_id),

  'merged_aliases', (
    -- From Mem0 identity table (this is the cross-surface graph)
    SELECT json_agg(json_build_object(
      'alias_id', alias_id, 'confidence', confidence, 'source', source))
    FROM mem0_identity_aliases
    WHERE primary_id = 'lead:' || $client_id::text),

  'wolf_surety', json_build_object(
    'quote_requests', (
      SELECT json_agg(json_build_object(
        'id', id, 'lob', line_of_business, 'status', status,
        'created_at', created_at, 'premium_amount', premium_amount))
      FROM ws_quote_requests WHERE client_id = $client_id),
    'policies', (
      SELECT json_agg(json_build_object(
        'policy_number', policy_number, 'lob', line_of_business,
        'carrier', carrier_name, 'status', status,
        'effective_date', effective_date, 'expiration_date', expiration_date,
        'premium_annual', premium_annual))
      FROM ws_policies WHERE client_id = $client_id),
    'claims', (
      SELECT json_agg(json_build_object(
        'claim_number', claim_number, 'lob', line_of_business,
        'status', status, 'loss_date', loss_date,
        'estimated_amount', estimated_amount, 'paid_amount', paid_amount,
        'adjuster', adjuster_name))
      FROM ws_claims WHERE client_id = $client_id)),

  'mortgage_dm', (
    SELECT json_agg(json_build_object(
      'loan_id', loan_id, 'status', loan_status,
      'loan_amount', loan_amount, 'closing_date', closing_date,
      'lender', lender, 'realtor', realtor))
    FROM dm_loans
    WHERE lower(client_email) = lower((SELECT email FROM clients WHERE id = $client_id))
       OR regexp_replace(coalesce(client_phone,''), '[^0-9]', '', 'g')
        = regexp_replace((SELECT phone FROM clients WHERE id = $client_id), '[^0-9]', '', 'g')),

  'cross_sells', (
    SELECT json_agg(json_build_object(
      'id', id, 'missing_lobs', missing_lobs, 'status', status,
      'estimated_premium', estimated_annual_premium,
      'estimated_commission', estimated_commission,
      'priority', priority, 'created_at', created_at))
    FROM cross_sell_opportunities WHERE client_id = $client_id),

  'recent_calls', (
    SELECT json_agg(json_build_object(
      'started_at', started_at, 'direction', direction,
      'duration_seconds', duration_seconds,
      'disposition', disposition, 'summary', left(summary, 200)))
    FROM vault_calls
    WHERE caller_id IN (SELECT phone FROM clients WHERE id = $client_id)
    ORDER BY started_at DESC LIMIT 10),

  'recent_emails', (
    SELECT json_agg(json_build_object(
      'subject', subject, 'sent_at', sent_at,
      'opened', opened_at IS NOT NULL,
      'clicked', clicked_at IS NOT NULL,
      'bounced', bounced_at IS NOT NULL))
    FROM email_tracking
    WHERE client_id = $client_id
    ORDER BY sent_at DESC LIMIT 10),

  'open_followups', (
    -- Most operationally important: what's still owed to / by this client?
    SELECT json_build_object(
      'open_claims', (SELECT count(*) FROM ws_claims
        WHERE client_id = $client_id
          AND lower(coalesce(status,'')) NOT IN ('closed','denied','withdrawn')),
      'pending_bind_requests', (SELECT count(*) FROM bind_requests br
        JOIN ws_quote_requests qr ON qr.id = br.quote_request_id
        WHERE qr.client_id = $client_id
          AND br.status = 'Approved'
          AND br.bound_at IS NULL),
      'policies_expiring_30d', (SELECT count(*) FROM ws_policies
        WHERE client_id = $client_id
          AND COALESCE(status,'Active') ILIKE 'active%'
          AND expiration_date BETWEEN now()::date AND (now() + interval '30 days')::date),
      'identified_cross_sells', (SELECT count(*) FROM cross_sell_opportunities
        WHERE client_id = $client_id AND status = 'identified'))
  )
) AS client360;
```

## Rendering rules

For chat, render in this order, dropping any section with no data:

```
🧑 <full_name> · <email> · <phone>
   <city>, <state> · client since <created_at>
   ezlynx_id: <if any> · merged with <N> aliases

📋 Open follow-ups
   🔥 <open_claims> open claims
   🔥 <pending_bind_requests> bind approvals waiting
   🔥 <policies_expiring_30d> policies expiring within 30 days
   🔥 <identified_cross_sells> cross-sells identified, not started

🛡️ Wolf Surety
   • <N> active policies (auto: $X, home: $Y)
   • <N> quote requests
   • <N> claims (<N open>)

🏠 Mortgage (DM)
   • <N> loans, latest: <status> $<loan_amount> closing <date>

🤝 Cross-sells: <list missing_lobs by status>

📞 Recent activity
   • Last call: <direction> · <duration>s · <disposition> · <date>
   • Last email: <subject> · opened: <bool> · <date>
```

## Hard rules

- **Read-only.** This skill never writes anywhere.
- **PII (full_name, email, phone) is OK to show in chat for client-
  specific lookups** — that's the entire point of this skill — but
  treat any export / paste with care. Don't surface other clients'
  PII just because they came up in a join.
- **`dm_loans` doesn't have `client_id`** — the join is by email or
  phone. May produce false matches if email/phone is shared across
  households. Show the count, ask the operator before drilling in.
- **`vault_calls.caller_id` is a phone string** (not a UUID). Match
  by phone, not by id.
- **Never expose `dm_loans.profit / total_comp / referral_fee`
  without explicit operator request** — those are commission numbers
  the client doesn't see.
- If the client has zero rows across every section, say so plainly:
  "no record of this client across Ziarem". Don't fabricate data.
