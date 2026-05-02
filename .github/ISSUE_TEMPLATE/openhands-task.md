---
name: OpenHands autonomous task
about: File an issue OpenHands can pick up and resolve via PR
title: "[openhands] "
labels: openhands, agent
assignees: ''
---

## What needs to happen

<!-- One-paragraph description of the desired end-state. Be concrete. -->

## Where in the codebase

<!-- File paths or table names. The more specific, the better. -->

- `hermes/...` or `supabase/migrations/...` or `scripts/...`

## Acceptance criteria

<!-- Checkboxes the agent can verify when it's done. -->

- [ ]
- [ ]
- [ ] CI lint workflow passes (5 jobs)
- [ ] If a migration is involved, it applies idempotently (re-running
      against an already-migrated DB is a no-op)

## Constraints / hard rules

<!-- Anything the agent must NOT do. Pre-fill with safe defaults. -->

- Do NOT modify `public.credentials` policies — that's parked.
- Do NOT push to `main` — open a PR with `claude/openhands-<short-name>`.
- Do NOT skip CI hooks.
- Carrier portal credentials and Vapi/Twilio keys NEVER printed in
  chat / commit messages / PR bodies.

## Context links

- `OPERATIONS.md` — current state of the system.
- `hermes/ziarem-soul.md` — domain model.
- Live Supabase project: `sfelhasepvaoianyuvxe` (read-only via
  Supabase MCP from your agent).

## Estimated size

- [ ] XS (< 1 file changed)
- [ ] S (1-3 files)
- [ ] M (4-10 files)
- [ ] L (10+ files — break into sub-tasks)
