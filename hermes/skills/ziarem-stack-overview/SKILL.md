---
name: ziarem-stack-overview
description: Use this skill when the user asks "what can you do", "what skills are available", "show me everything", "help", "list capabilities", "what's the stack", or wants the bird's-eye view of every Hermes skill, every cron job, every Ziarem app. Read-only meta-skill. Routes the operator to the right specific skill for their question.
---

# Ziarem stack — what's installed, what does what

## Skill index (use this to route operator questions)

### Operator daily-use

| Skill                | When to use                                                                  |
| -------------------- | ---------------------------------------------------------------------------- |
| `ziarem-status`      | "Is everything working?" — one-shot live audit                               |
| `daily-standup`      | 8 AM brief: wins / new pipeline / blockers / WTD revenue / comms             |
| `client-360`         | "Tell me everything about <client>" by id/email/phone/name                   |
| `ziarem-revenue-desk`| WTD / MTD / YTD revenue across DM, WS, Re4lty                                |
| `hermes-doctor-deep` | Full-stack health check (Tier-1 keys, cron jobs, RLS, fleet HTTP, heartbeats)|
| `hermes-keys`        | Resolve external service keys from `public.credentials`                      |

### Operations / fix-it

| Skill                | When to use                                                                  |
| -------------------- | ---------------------------------------------------------------------------- |
| `cross-sell-unstick` | List opportunities frozen at `identified` > 7 days, propose next action      |
| `marketing-revive`   | Diagnose why no email has gone out (cron / sender / suppression / reputation)|
| `marketing-fire`     | Pick highest-priority dormant campaign, print operator command to send it    |
| `re4lty-cross-sell`  | Idempotently fan out cross-sells when a Re4lty offer is accepted             |
| `hermes-onboarding`  | Drive a new lead from arrival through identity merge → cross-sell → routing  |

### Per-business pipelines (read-only views by stage)

| Skill                | App         | Stages                                                       |
| -------------------- | ----------- | ------------------------------------------------------------ |
| `wolf-pipeline`      | Wolf Surety | 6 (intake → quotes → bind → book → renewals → claims) + carrier capacity |
| `dm-pipeline`        | Dos Mortgage| 7 (new → processing → CTC → funded → handoff → lock-warn → stalled) |
| `cbw-orders`         | CBW         | 8 (closing this/next wk → stuck → approvals → automation → auto-checks → slots → revenue → cross-sell) |
| `vault-deals`        | Vault       | 7 (pipeline → stalled → cross-sell tree → multi-deal → docs → insurance handoff → credit repair) |
| `ph-property-hunter` | Prop Hunter | 7 (scout state → signals → top-scored → probate → skip-trace → yield → P&L) |
| `ff-fix-flip`        | Fix & Flip  | 6 (sources → top deals → comps → risk → activity → handoff)  |
| `cd-dispute`         | Dispute LLC | 4 (roster → dispute queue → letter cadence → graduation)     |
| `social-creator`     | Social      | 4 (brand health → queue → engagement → compliance gate)      |
| `oss-radar`          | OSS Radar   | 5 (last scan → hot rising → adoptions → coverage gaps → searches) |
| `health-insurance`   | Health      | 6 (config → quotes → eligibility → enrollment → policies → webhooks) |
| `auto-insurance`     | Auto        | 6 (intake → readiness → book → renewals → drip → SR-22)      |

### Routing / agent fleet

| Skill                | What it routes                                                               |
| -------------------- | ---------------------------------------------------------------------------- |
| `agent-fleet`        | Cross-agent rules between Skyvern / Crawl4AI / Mem0 / Pipecat / OpenHands    |
| `mem0-resolve`       | Identity merging via UNION-FIND across surfaces                              |
| `crawl4ai-fanout`    | Research crawl orchestration                                                 |
| `openhands-handoff`  | Issue → autonomous PR                                                        |

## Live automation (running nightly via pg_cron)

| Job                                | Schedule       | Function                          |
| ---------------------------------- | -------------- | --------------------------------- |
| `hermes-dm-cross-sell-daily`       | `30 6 * * *`   | `fn_detect_dm_cross_sells()`      |
| `hermes-vault-cross-sell-daily`    | `31 6 * * *`   | `fn_detect_vault_cross_sells()`   |

Both: SECURITY INVOKER, search_path pinned, EXECUTE granted only to
`service_role`, idempotent NOT EXISTS, strict email-only client lookup.

## Migrations applied (live Supabase)

```
20260430120000  hermes_fleet_tables       crawl4ai_sources, mem0_*, skyvern_jobs, v_customer_identities
20260501000000  credentials_catalog       38 catalog rows + v_credentials_admin view
20260502000000  hermes_rls_lockdown       RLS + security_invoker + search_path fixes
20260503000000  dm_cross_sell_detector    fn_detect_dm_cross_sells + v_dm_cross_sell_candidates
20260504000000  cross_sell_cron_schedule  fn_detect_vault_cross_sells + 2 pg_cron jobs
```

Plus one **PARKED** (filename excluded from `2026*.sql` glob — apply
manually after admin UI moves to `v_credentials_admin`):

```
_PARKED_credentials_policy_fix.sql   tighten public.credentials policies
```

## Apps registered (32 in `hermes/apps.yaml`)

Anchors: `re4lty`, `vault` (dm-anchor)
Insurance: `ws`, `health`, `auto`, `insurance`, `carrier`, `wolf`
Mortgage / lending: `dm`, `m0`, `e9`
Real estate: `ph`, `ff`, `d4`, `p7`
Title / closing: `cbw`, `cc`
Credit / finance: `cd`, `primvx`, `plaid`
Health services: `hha`
Creator / social: `ziarem`, `social`, `vk`
Operations / glue: `ai`, `pro`, `business`, `crm`, `drive`, `outreach`, `oss`, `nas`

## How Hermes picks a skill

The frontmatter `description` field is what triggers loading. Operator
phrasing → skill mapping is intentionally redundant. Examples:

- "morning briefing", "standup", "what's blocked" → `daily-standup`
- "is X working", "status", "dashboard" → `ziarem-status`
- "tell me about <client>" → `client-360`
- "stuck cross-sells" → `cross-sell-unstick`
- "send the campaign" → `marketing-fire`
- "auto policy renewals" → `auto-insurance`
- "what skills exist", "help" → THIS skill

If the operator phrasing doesn't match a description, default to
`ziarem-status` and let the operator narrow.

## Hard rules (apply across all skills)

1. **Read-only by default.** State changes go through admin UIs / per-
   business workflows, not Hermes chat.
2. **Lowercase status taxonomy.** Live data is `active|sent|new|
   identified|qualified|closed|delivered|draft|scheduled|sending|
   completed`. Always `lower()` or case-insensitive compare.
3. **No key bytes in chat output.** Use `v_credentials_admin` for
   presence checks; never SELECT `credentials.api_key`.
4. **PII (full names, phones, emails) only in client-specific lookups.**
   Aggregate dashboards use counts, not lists.
5. **Carrier portal credentials NEVER printed** — log scrubbing
   matters.
6. **Bilingual EN/ES.** Detect `preferred_language`, default EN if
   missing.
7. **Cross-sell uniqueness is `(client_id, missing_lobs)`** — always
   guard with NOT EXISTS before INSERT.
8. **`ws_outbound_queue` ≠ `skyvern_jobs`.** Voice-call queue vs.
   Skyvern dispatch queue. Different shapes, different purposes.
