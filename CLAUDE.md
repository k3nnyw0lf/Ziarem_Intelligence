# Working in this repo with Claude Code

This is the Ziarem Intelligence repo — Hermes (NousResearch agent fork) + the
multi-app overlay that lets one operator agent answer questions about every
Ziarem business from one place.

If you (Claude / OpenHands / any agent) are dropped in here cold, start here.

## Repo map (the parts that matter)

```
hermes/                 ← The overlay applied to every downstream Ziarem repo
  apps.yaml             ← 32 registered apps (auto-discovered + curated)
  ziarem-soul.md        ← Domain context. Statuses lowercase, RLS-verified.
  agents/               ← Agent fleet (Skyvern / Crawl4AI / Mem0 / Pipecat / OpenHands)
    install-global.sh   ← Brings the fleet up via docker-compose
    doctor.sh           ← Health check
    skyvern/workflows/  ← 6 Wolf Insurance carrier-portal workflows
  skills/               ← Hermes skills. Each is a SKILL.md with frontmatter.
    ziarem-status       ← Live ops audit (marketing + sales + cross-business)
    daily-standup       ← Operator morning brief
    cross-sell-unstick  ← Move stuck cross-sells forward
    marketing-revive    ← Diagnose dormant email senders
    hermes-keys         ← Resolve service keys from public.credentials
    re4lty-cross-sell   ← Anchor automation: under_contract → fan-out
    ziarem-revenue-desk ← WTD / MTD / YTD revenue across DM, WS, Re4lty
    agent-fleet         ← Cross-agent routing rules
    mem0-resolve        ← Identity merging via UNION-FIND
    crawl4ai-fanout     ← Research crawl orchestration
    openhands-handoff   ← Issue → autonomous PR
supabase/migrations/    ← SQL migrations
  20260430...hermes_fleet_tables.sql      ← crawl4ai_sources, mem0_*, skyvern_jobs, v_customer_identities
  20260501...credentials_catalog.sql      ← 38 catalog rows, v_credentials_admin
  20260502...hermes_rls_lockdown.sql      ← RLS + security_invoker fix
.github/
  workflows/hermes-lint.yml ← Gates every PR (YAML / Bash / Node / SQL / Skill)
  workflows/hermes-sync.yml ← Weekly cross-repo overlay sync
  ISSUE_TEMPLATE/openhands-task.md ← For autonomous task dispatch
scripts/
  discover-apps.cjs     ← Auto-registers new app prefixes from Postgres
OPERATIONS.md           ← Live state of the system, what to do next
```

## Hard rules — ALWAYS

1. **Status taxonomy is lowercase.** The live data uses
   `active|sent|new|identified|qualified|closed|delivered|draft|scheduled|sending|completed`.
   Any skill or query that compares to `Active` / `Closed` / `Pending` is
   wrong. Always lowercase or `lower()` both sides.
2. **`ws_outbound_queue` is the Wolf Surety voice-call queue (Twilio/Vapi).**
   Skyvern jobs use `skyvern_jobs`. They are NOT the same queue.
3. **`credentials.api_key` / `api_secret` / `smtp_pass` bytes never leave
   server-side code.** Read presence flags via `v_credentials_admin`.
4. **Never push to `main`.** Always branch to `claude/<short-name>` and PR.
5. **Never `--no-verify`** on commits.
6. **Carrier portal credentials NEVER printed in logs / chat / commit messages.**
7. **`re4lty_offers.lead_id` is text** — cast to `::uuid` before joining
   to `clients.id` / `cross_sell_opportunities.client_id`.

## Schema gotchas (verified against live Supabase)

These are the 25+ schema bugs that made every Wolf workflow fail before fix:

- `carriers` has **`short_code`**, NOT `naic_code`.
- `carrier_appetite` has **`risk_factor`**, NOT `risk_class`.
- `carrier_targets` is appointment-tracking — **no `daily_used`/`daily_limit`**.
- `ws_carrier_quotes` uses **`premium_annual`**, NOT `annual_premium`. Coverage
  splits into `coverage_a / deductible_aop / deductible_hurricane`.
- `ws_policies` uses **`expiration_date`**, NOT `expiry_date`.
- `ws_communications` columns: `client_id, channel, direction, subject, body,
  status, language` — NOT `claim_id, kind, summary, source`.
- `bind_requests` has **`bound_by` / `bound_at`**, NOT `approved_by` /
  `processed_at`. Lookup `client_id` via JOIN to `ws_quote_requests`.
- `binds` uses **`quote_id` / `final_premium`**, NOT `bind_request_id` /
  `bound_premium`.
- `pro_licenses` uses **`license_state` / `license_category` /
  `verification_status` / `verified_at`**, NOT `state` / `license_type` /
  `status` / `last_verified_at` / `active`. NPN lives in
  `verification_data` jsonb.
- `renewals` natural key is **`bind_id`**, NOT `policy_id`.

## How to add a new skill

1. Create `hermes/skills/<name>/SKILL.md`.
2. Frontmatter must have `name:` and `description:` between `---` markers.
   The `description` is what triggers Hermes to load it — write it from
   the operator's perspective ("Use this when…").
3. Body: short rationale, the SQL / commands to run, hard rules at bottom.
4. CI's "Skill frontmatter" job will reject malformed files.

## How to add a new migration

1. Filename: `supabase/migrations/2026<MM><DD><HHMMSS>_<snake_case>.sql`.
   Lexical order matters; pick a number after the latest `2026*.sql`.
2. **Idempotent.** Use `CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`,
   `DROP POLICY IF EXISTS` before `CREATE POLICY`.
3. **RLS.** Any new table in `public` MUST `ENABLE ROW LEVEL SECURITY`
   and have at least one policy. The Supabase advisor will flag it
   otherwise (P0). Default for Hermes-internal tables: `TO service_role
   USING (true) WITH CHECK (true)`.
4. **Views.** Create with `WITH (security_invoker = on)` — never the
   default SECURITY DEFINER.
5. **Trigger functions.** `SET search_path = pg_catalog, pg_temp` to
   silence the advisor's mutable-search-path warning.
6. CI applies all `2026*.sql` against fresh Postgres-17 with
   `service_role`/`authenticated`/`anon` pre-created. Test locally first:
   ```
   sudo -u postgres psql -c "CREATE DATABASE ci"
   for r in service_role authenticated anon; do
     sudo -u postgres psql -d ci -c "CREATE ROLE $r NOLOGIN" 2>/dev/null
   done
   for f in supabase/migrations/2026*.sql; do
     sudo -u postgres psql -d ci -v ON_ERROR_STOP=1 -f "$f"
   done
   ```

## Live Supabase

Project `sfelhasepvaoianyuvxe`. Read with the Supabase MCP
`execute_sql`; write DDL with `apply_migration` (it transactions
+ rolls back on error). Don't paste migrations through the UI; the MCP
tracks history.

The 1MB advisor output is unreadable in one go — use `get_advisors`,
the MCP saves the result to a file you can `Read` in chunks or ship to
a subagent.

## What's running, what's dormant (April 2026)

See `OPERATIONS.md`. Headline: infra configured, 27/27 email senders
active, 32 apps registered, 57 credential slots — but 0 sends in 30
days, 0 Vapi calls in 7 days, 15 cross-sells frozen at `identified`.
**The system is dressed and waiting; nothing's been turned on yet.**

## Tier-1 keys you'll need from the user

`hermes-keys` skill maps service names. The 6 highest-leverage to
populate first:

1. `Google Gemini API` — Hermes default LLM
2. `OpenAI API (shared by Crawl4AI/Mem0/Pipecat)` — three agents on one key
3. `Vapi - AI Voice Calls` — AI sales floor
4. `Telegram Bot - Hermes Gateway` — fastest operator surface
5. `GitHub PAT - Hermes Skills Hub` — kills 60 req/hr unauth limit
6. `Cloudflare Turnstile - Apply Form` — apply form bot protection

## Pre-existing P0 — not introduced by Hermes, parked

`public.credentials.admins_full_access` policy grants `authenticated`
JWT full SELECT on every key. Recommended fix in `OPERATIONS.md`.
DO NOT apply without coordinating with the admin UI in the
`lead-manager-crm` repo (separate codebase).

## Useful commands

```bash
# Re-run the live audit
hermes -z "use ziarem-status to give me a one-paragraph state-of-the-business"

# Morning brief
hermes -z "use daily-standup"

# Find missing keys
hermes -z "use hermes-keys to list every empty credential by category"

# Stuck cross-sells
hermes -z "use cross-sell-unstick to list opps frozen > 7 days"

# Verify the agent fleet
bash hermes/agents/doctor.sh
```
