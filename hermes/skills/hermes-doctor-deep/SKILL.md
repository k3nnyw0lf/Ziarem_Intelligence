---
name: hermes-doctor-deep
description: Use this skill when the user asks "is everything actually working", "deep health check", "test every key", "smoke-test the stack", "what's broken", or after populating new keys. Goes beyond `bash hermes/agents/doctor.sh` (which only pings local services) to verify (a) every credentials row has its key set, (b) every cron job has run recently, (c) every Hermes table has expected RLS, (d) every fleet service responds. Read-only.
---

# Hermes deep doctor — full-stack smoke test

Run this when:
- You've just populated a batch of keys and want to confirm they wired through.
- A nightly cron didn't surface its expected output.
- The shallow `doctor.sh` is green but operators report broken behavior.

## Stage 1 — Credentials catalog coverage

```sql
SELECT category,
       count(*)                              AS total,
       count(*) FILTER (WHERE has_api_key)   AS keys_set,
       count(*) FILTER (WHERE NOT has_api_key) AS need_filling,
       round(100.0 * count(*) FILTER (WHERE has_api_key) / count(*), 0) AS pct_filled
FROM v_credentials_admin
GROUP BY category
ORDER BY pct_filled ASC, category;
```

Surface categories with `pct_filled < 50` first — they're the bottleneck.

## Stage 2 — Tier-1 keys present?

```sql
SELECT service_name, has_api_key
FROM v_credentials_admin
WHERE service_name IN (
  'Google Gemini API',
  'OpenAI API (shared by Crawl4AI/Mem0/Pipecat)',
  'Vapi - AI Voice Calls',
  'Telegram Bot - Hermes Gateway',
  'GitHub PAT - Hermes Skills Hub',
  'Cloudflare Turnstile - Apply Form'
)
ORDER BY has_api_key, service_name;
```

If any are `false`: that's why the corresponding surface is dark.

## Stage 3 — Hermes pg_cron jobs healthy?

```sql
SELECT j.jobname, j.schedule, j.active,
       (SELECT max(start_time)
        FROM cron.job_run_details rd
        WHERE rd.jobid = j.jobid)                         AS last_run_at,
       (SELECT status FROM cron.job_run_details rd
        WHERE rd.jobid = j.jobid
        ORDER BY start_time DESC LIMIT 1)                 AS last_status,
       (SELECT count(*) FROM cron.job_run_details rd
        WHERE rd.jobid = j.jobid
          AND rd.start_time > now() - interval '7 days'
          AND rd.status = 'failed')                       AS fails_7d
FROM cron.job j
WHERE j.jobname LIKE 'hermes-%'
ORDER BY j.jobname;
```

If `last_run_at` is more than 25 hours old for a daily cron: it's
silently broken.

## Stage 4 — Hermes-managed table RLS state

```sql
SELECT c.relname,
       c.relrowsecurity                   AS rls_enabled,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'crawl4ai_sources','mem0_identity_aliases','mem0_identity_unmerges',
    'skyvern_jobs')
ORDER BY c.relname;
```

All four MUST show `rls_enabled = true` and `policies >= 1`.

## Stage 5 — Hermes views security_invoker state

```sql
SELECT c.relname, c.reloptions
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('v_customer_identities','v_credentials_admin');
```

Both should include `security_invoker=on`. If not, RLS pass-through
is broken.

## Stage 6 — Apps roster sanity

```sql
SELECT
  (SELECT count(*) FROM (
    SELECT split_part(table_name,'_',1) AS prefix
    FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE'
      AND position('_' IN table_name) > 0
    GROUP BY prefix HAVING count(*) >= 2) sub)            AS prefixes_with_2plus_tables,
  -- The number of slugs registered in apps.yaml is read from disk by
  -- discover-apps.cjs; here we just emit the prefix list for the
  -- operator to diff manually.
  array_agg(DISTINCT prefix ORDER BY prefix)              AS all_prefixes
FROM (
  SELECT split_part(table_name,'_',1) AS prefix
  FROM information_schema.tables
  WHERE table_schema='public' AND table_type='BASE TABLE'
    AND position('_' IN table_name) > 0
) x;
```

If this returns prefixes not in `hermes/apps.yaml`, run
`node scripts/discover-apps.cjs` to register them.

## Stage 7 — Fleet services (run from a host on the LAN)

```bash
# These can't be SQL'd; the operator runs them from the Wolf Machine
# or wherever the agents live.

curl -s -o /dev/null -w "skyvern  %{http_code}\n" http://10.1.10.42:8000/healthz
curl -s -o /dev/null -w "n8n      %{http_code}\n" http://10.1.10.42:5678/healthz
curl -s -o /dev/null -w "crawl4ai %{http_code}\n" http://10.1.10.42:11235/health
curl -s -o /dev/null -w "mem0     %{http_code}\n" http://10.1.10.42:8080/health
curl -s -o /dev/null -w "pipecat  %{http_code}\n" http://10.1.10.42:7860/health
curl -s -o /dev/null -w "openhands %{http_code}\n" http://10.1.10.42:3010/health
```

Anything not 200 = service down. Check `bash hermes/agents/doctor.sh`
for the full diagnostic.

## Stage 8 — Recent activity heartbeats

```sql
SELECT
  'vault_calls'                AS surface, max(started_at) AS last_event FROM vault_calls
  UNION ALL SELECT 'vault_email_sends',     max(created_at) FROM vault_email_sends
  UNION ALL SELECT 'vault_telegram_messages', max(created_at) FROM vault_telegram_messages
  UNION ALL SELECT 'leads',                 max(created_at) FROM leads
  UNION ALL SELECT 'cross_sell_opportunities', max(updated_at) FROM cross_sell_opportunities
  UNION ALL SELECT 'skyvern_jobs',          max(created_at) FROM skyvern_jobs
ORDER BY last_event DESC NULLS LAST;
```

A surface that hasn't seen activity in > 7 days while operators are
expected to be working it: surface is broken. Drill in via the
per-business pipeline skill.

## Reporting rules

Render the result as a checklist with green / yellow / red icons:

```
Stage 1: Credentials       — [yellow] 13/57 keys set (23%)
Stage 2: Tier-1 keys       — [red]    Gemini missing, OpenAI missing
Stage 3: Cron jobs         — [green]  hermes-dm-* ran 3h ago, ok
Stage 4: Hermes RLS        — [green]  4/4 tables locked, 1 policy each
Stage 5: View invoker      — [green]  both views security_invoker=on
Stage 6: App roster        — [green]  all prefixes in apps.yaml
Stage 7: Fleet HTTP        — operator must run from LAN
Stage 8: Heartbeats        — [yellow] no email sends for 30d
```

## Hard rules

- **Read-only.** Never repair from this skill — diagnose, then surface
  the right repair skill (e.g. `marketing-revive` for stale email).
- **NEVER print key values.** Stage 1 / 2 use `has_api_key` boolean
  only. If the operator pastes output into Slack, no secrets leak.
- **Cron job ownership.** Only inspect `cron.job` rows where
  `jobname LIKE 'hermes-%'` — other jobs (cbw-*, ff-*, ghl-*) belong
  to other systems.
- **Stage 7 is operator-driven.** Hermes can't `curl` the LAN from
  Supabase; the operator runs those from a box that can.
