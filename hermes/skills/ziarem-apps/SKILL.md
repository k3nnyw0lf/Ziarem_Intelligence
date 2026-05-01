---
name: ziarem-apps
description: Use this skill before answering ANY question about Ziarem business data. The Ziarem Supabase project hosts ~25 sub-apps in one shared Postgres, each living under a table prefix (e.g. vault_*, re4lty_*, dm_*, cbw_*, ws_*, ph_*, ff_*, ziarem_*). This skill tells you which prefix belongs to which app, and routes the user's question to the right scope so you don't accidentally read another product's data. Trigger on: "leads in <app>", "show <app>", "how many <thing>", "revenue", "cross-sell", or any business question that mentions a product name listed in apps.yaml.
---

# Ziarem app routing

The Supabase project is `sfelhasepvaoianyuvxe`. Every product co-tenants in
`public.*` and is identified by a prefix. The full manifest is in
`<repo>/hermes/apps.yaml` — read it before answering, then scope all SQL,
table listings, and exports to that prefix.

## How to use

1. **Identify the app** from the user's question. Match against `apps.yaml`:
   - real-estate sale → `re4lty_*` (anchor) or `ph_*` / `d4_*` / `p7_*` /
     `ff_*` depending on context.
   - mortgage origination → `dm_*` (Dos Mortgage) or `e9_*` / `m0_*`.
   - title / closing → `cbw_*` (Closed By Whom?) or `cc_*`.
   - insurance → `ws_*` (Wolf Surety), `health_*`, `auto_*`, generic
     `insurance_*`.
   - credit → `cd_*` (Dispute LLC) or `primvx_*`.
   - creator suite → `ziarem_*` or `social_*`.
   - core CRM → `vault_*`.
   - operations → `nas_*`, `oss_*`, `plaid_*`.
2. **If ambiguous**, ask the user which app — don't guess across prefixes.
3. **Stay inside the prefix**: `SELECT * FROM <prefix>_<table>` only. Do not
   `JOIN` across prefixes unless `apps.yaml` flags an `anchor` relationship
   (e.g. `re4lty_leads` → cross-sell rows in other apps' tables).
4. **Cross-sell rule** (anchors only): when a `re4lty_*` lead flips to
   `Under Contract`, write to `dm_*`, `vault_*`, `cbw_*`, `ws_*` per the
   revenue table in `~/.hermes/SOUL.md`.
5. **RLS**: most tables are RLS-enabled. Use the service role key only for
   admin tasks; default reads via Hermes should go through the anon role
   plus appropriate policies.

## When the user adds a new app

Append a new entry to `<repo>/hermes/apps.yaml` with prefix, vertical,
anchor flag, and a one-line note. No code change needed — Hermes re-reads
the file on every run.

## Hard rules

- Never page across prefixes silently. If a query touches two prefixes,
  surface it.
- Never expose row counts of one app in the answer to a question about
  another app.
- Never assume `leads` (no prefix) belongs to a specific app — it's a
  shared table; clarify which vertical the user means.
