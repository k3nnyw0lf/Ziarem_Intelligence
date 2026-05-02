---
name: cd-dispute
description: Use this skill for Dispute LLC — credit-repair pipeline. Trigger on "credit dispute", "Dispute LLC", "credit repair clients", "score progress", "letters sent", "bureau status". Read-only view of cd_clients / cd_disputes / cd_letters. Cross-business: lead tag `Credit_Repair_Urgent` from `lead_scorer.js` should land in cd_clients.
---

# Dispute LLC — credit-repair pipeline

```
intake (cd_clients)
  ↓ pull baseline (eq_score, tr_score, ex_score)
cd_disputes (one row per inaccurate item)
  ↓ generate cd_letters by letter_type
sent → bureau response (response_date)
  ↓ result: removed | updated | unchanged
score re-pull → graduate when target_score met
```

## Stage 1 — Active client roster

```sql
SELECT c.id, c.full_name, c.email, c.phone, c.status,
       c.eq_score, c.tr_score, c.ex_score, c.target_score,
       greatest(c.target_score - c.eq_score,
                c.target_score - c.tr_score,
                c.target_score - c.ex_score) AS biggest_gap,
       c.enrollment_date,
       (now()::date - c.enrollment_date::date) AS days_enrolled,
       (SELECT count(*) FROM cd_disputes d
         WHERE d.client_id = c.id AND lower(d.status) IN ('filed','pending')) AS open_disputes,
       (SELECT count(*) FROM cd_letters l
         WHERE l.client_id = c.id AND l.sent_at IS NOT NULL)                  AS letters_sent
FROM cd_clients c
WHERE lower(coalesce(c.status,'')) NOT IN ('graduated','cancelled','dropped')
ORDER BY days_enrolled DESC;
```

## Stage 2 — Dispute queue (no response yet)

```sql
SELECT d.id, d.bureau, d.account_name, d.account_number,
       d.reason, d.status, d.letter_type,
       d.date_filed,
       (now()::date - d.date_filed::date) AS days_filed,
       c.full_name, c.id AS client_id
FROM cd_disputes d
JOIN cd_clients c ON c.id = d.client_id
WHERE d.response_date IS NULL
  AND lower(coalesce(d.status,'')) IN ('filed','pending')
ORDER BY d.date_filed ASC;
```

The FCRA gives bureaus 30 days to respond. Disputes with `days_filed
> 30` should escalate.

## Stage 3 — Letter cadence (one per bureau per round)

```sql
SELECT d.client_id, c.full_name, d.bureau,
       count(DISTINCT l.id) AS letters_sent,
       max(l.sent_at)        AS last_letter_at,
       max(d.status)         AS dispute_status
FROM cd_disputes d
JOIN cd_clients  c ON c.id = d.client_id
LEFT JOIN cd_letters l ON l.dispute_id = d.id
WHERE lower(d.status) NOT IN ('removed','closed','denied')
GROUP BY d.client_id, c.full_name, d.bureau
ORDER BY last_letter_at NULLS FIRST;
```

If `last_letter_at < now() - 21 days` and dispute still open: send the
next round.

## Stage 4 — Score progress over time (graduation tracker)

```sql
SELECT c.full_name,
       c.target_score,
       c.eq_score, c.tr_score, c.ex_score,
       least(c.eq_score, c.tr_score, c.ex_score)  AS lowest_bureau,
       greatest(c.eq_score, c.tr_score, c.ex_score) AS highest_bureau,
       round((c.eq_score + c.tr_score + c.ex_score) / 3.0, 0) AS avg_score,
       c.target_score - round((c.eq_score + c.tr_score + c.ex_score) / 3.0, 0) AS pts_to_target
FROM cd_clients c
WHERE lower(coalesce(c.status,'')) = 'active'
ORDER BY pts_to_target ASC;
```

Clients with `pts_to_target <= 0` are ready to graduate — flip to
`graduated` in the cd UI.

## Hard rules

- **FCRA timeline.** Bureau has 30 days to respond. Don't fire round 2
  before day 30 — it's harassment.
- **Letter content NEVER includes the client's full SSN.** First name +
  last 4 of SSN only on every cd_letters row.
- **Dispute reason must be specific** (not "this is wrong"). "This
  account is not mine" / "Date opened is incorrect" / "Reported as
  late but I have proof of payment". Generic disputes are auto-rejected.
- **Cross-sell upstream.** Mortgage applicants with mid-FICO < 620 get
  tagged `Credit_Repair_Urgent` — that's a cd_clients candidate.
- **Graduation kicks the client back** to mortgage / lending workflows
  — flip `vault_loans.credit_repair_enrolled = false` and let DM
  re-quote.
