# Ziarem operations — live state

Snapshot of every Ziarem app and integration as of the Hermes install.
This file is the human counterpart to `hermes/skills/ziarem-status/SKILL.md`
(machine-readable status query that returns the same picture).

> Numbers below are from a live audit of Supabase project
> `sfelhasepvaoianyuvxe`. Re-run with
> `hermes -z "use ziarem-status"` from the CLI or
> `hermes -z "use hermes-doctor-deep"` for the full smoke test.

> **Skill index:** see `hermes/skills/ziarem-stack-overview/SKILL.md` for
> the full routing table — every skill, every cron job, every migration,
> every registered app.

## Headline

Infrastructure **wired and now self-driving where possible**. 32 apps
registered, 57 credential slots catalogued, **2 nightly cron jobs**
filling the cross-sell pipeline (`hermes-dm-cross-sell-daily` 06:30 UTC,
`hermes-vault-cross-sell-daily` 06:31 UTC). Operator surfaces (Vapi
calls, email blasts) still need keys to come online.

| Surface              | State     | Action                                         |
| -------------------- | --------- | ---------------------------------------------- |
| Marketing senders    | 27 active | Need a live campaign. See `marketing-revive` (diagnose) + `marketing-fire` (act). |
| Marketing campaigns  | 1 active, 5 sent, 8 drafted | Activate one or revive cron. |
| AI sales (Vapi)      | 0 calls / 7d | Populate `Vapi - AI Voice Calls` credentials row, verify webhook. |
| Cross-sell pipeline  | 15 stuck at `identified` (legacy); new ones now auto-detected nightly | `cross-sell-unstick` for legacy; cron handles new |
| Lead intake          | 22 new (none qualified) | Wire `hermes-onboarding` skill into Vapi/apply-form/Telegram entry points. |
| Telegram             | 3 configs active, 0 msgs / 7d | Bot not connected — needs `Telegram Bot - Hermes Gateway` token. |
| Skyvern (Wolf)       | Deployed at `10.1.10.42:8000` | 6 workflows ready (schema-fixed in PR #5); needs `skyvern_jobs` rows. |
| Property Hunter      | 31/32 APIs enabled, 0 properties scraped | Scout cron not running. See `ph-property-hunter`. |
| Cross-sell automation| `fn_detect_dm_cross_sells` + `fn_detect_vault_cross_sells` running nightly | Self-driving — no operator action needed |

## Apps roster (32 registered in `hermes/apps.yaml`)

### Anchors & cross-sell drivers

| Slug      | Name                  | Vertical    | Notes                                                    |
| --------- | --------------------- | ----------- | -------------------------------------------------------- |
| `re4lty`  | Re4lty Inc.           | real-estate | **Anchor.** Under Contract → cross-sell to dm/cbw/ws/vault. |
| `vault`   | VAULT CRM             | ops         | Multi-business pipeline. 462 `vault_loans`.              |
| `dm`      | Dos Mortgage          | mortgage    | 456 `dm_loans`. Revenue 2.75% × loan_amount.             |
| `cbw`     | Closed By Whom?       | title       | 2009 realtors, 744 lenders, 546 prospects, 18707 OFAC.   |
| `ws`      | Wolf Surety           | insurance   | 496 clients, 101 quote requests, 48 carrier quotes, 20 policies, 10 claims. |
| `cd`      | Dispute LLC           | credit      | Credit repair. Lead tag `Credit_Repair_Urgent`.          |
| `cc`      | Closing Coordinator   | title       | Sister to cbw. 79 compliance forms.                      |

### Real estate / lending

| Slug      | Name                  | Notes                                        |
| --------- | --------------------- | -------------------------------------------- |
| `ph`      | Property Hunter       | Skip-trace + probate. 32 ph_api_registry.    |
| `ff`      | Fix & Flip            | 13 wholesalers, 375 scan logs.               |
| `e9`      | Equity9               | Borrower nurture sequences.                  |
| `m0`      | M0 Pipeline           | Rate snapshots + listing checks.             |
| `d4`      | D4                    | Markets + saved searches.                    |
| `p7`      | P7                    | Simulations + decisions.                     |
| `primvx`  | PrimVX                | Soft-pull + monitoring.                      |

### Insurance + adjacent

| Slug          | Notes                                                   |
| ------------- | ------------------------------------------------------- |
| `carrier`     | Powers ws_*. 85 carriers, 59 appetite rows.             |
| `health`      | ACA / Medicare / Medicaid quoting (dormant).            |
| `auto`        | 24 marketing sequences (dormant).                       |
| `insurance`   | Generic insurance leads/quotes/binds.                   |
| `wolf`        | Wolf Surety AI memory.                                  |

### Operations / glue

| Slug         | Notes                                                  |
| ------------ | ------------------------------------------------------ |
| `ai`         | 67 ai_knowledge_base rows. Shared knowledge layer.     |
| `pro`        | Producer profiles + licensing + payouts.               |
| `business`   | Business entity management.                            |
| `crm`        | Generic cross-app CRM primitives.                      |
| `nas`        | NAS service catalog.                                   |
| `oss`        | OSS Radar (`oss_radar_tools`, `oss_stack`).            |
| `social`     | 6 brands, 15 posts. Social agent surface.              |
| `ziarem`     | Creator AI suite — 50 video jobs, 7 brands.            |
| `hha`        | Home Health Aide EVV/scheduling.                       |
| `vk`         | VK clients/orders.                                     |
| `plaid`      | Banking integration.                                   |
| `drive`      | Google Drive watch log.                                |
| `outreach`   | Outbound outreach campaigns.                           |

## Credentials catalog (57 entries)

`hermes/skills/hermes-keys/SKILL.md` is the runtime resolver. The admin
UI reads `public.v_credentials_admin` for status without exposing values.

| Category            | Total | Set | Need filling |
| ------------------- | ----: | --: | -----------: |
| general             |     8 |   2 |            6 |
| messaging_gateway   |     6 |   0 |            6 |
| agent_fleet         |     5 |   0 |            5 |
| email_provider      |     5 |   0 |            5 |
| voice               |     5 |   0 |            5 |
| ai_services         |     5 |   1 |            4 |
| compliance          |     4 |   0 |            4 |
| research            |     4 |   0 |            4 |
| github              |     3 |   0 |            3 |
| infrastructure      |     6 |   4 |            2 |
| mls                 |     3 |   3 |            0 |
| wolf_machine        |     2 |   2 |            0 |
| personal            |     1 |   1 |            0 |

**Already populated** (operationally complete at the platform layer):

- `Anthropic Claude API` — **Hermes default LLM** (no Gemini key needed; Anthropic works directly with the Hermes agent fork)
- `Skyvern RPA (after deployment)` — running on Wolf Machine `10.1.10.42:8000`
- `n8n Wolf Machine (after deployment)` — running on Wolf Machine `10.1.10.42:5678`
- Supabase (both project entries) · 3 MLS providers · Synology NAS DSM (3 entries) · Hostinger Webmail · Google Account · Wolf Machine DSM Python Client

**Still empty — top 6 highest-leverage** (in priority order for what they unlock):

1. `Telegram Bot - Hermes Gateway` — fastest operator surface to come online (5 min from `@BotFather`)
2. `OpenAI API (shared by Crawl4AI/Mem0/Pipecat)` — these three agents need OpenAI for embeddings; one key, three services
3. `Vapi - AI Voice Calls` — without it, AI sales floor stays dark (`vault_calls` = 0 / 7d)
4. `GitHub PAT - Hermes Skills Hub` — kills the 60 req/hr unauth rate limit on skill installs
5. `Cloudflare Turnstile - Apply Form` — bot protection on the apply form (parked in lead-manager-crm)
6. **At least one email provider** (Mailgun / Resend / Postmark / SendGrid / SES) — so `omni_sender.js` can route campaigns. Pick one.

Note: Hermes runs on Anthropic Claude API; you don't need a separate Gemini key. The Gemini catalog row stays as an option for fallback chain (`hermes fallback add gemini ...`) but isn't blocking anything.

## Hermes agent fleet (Wolf Machine LAN)

Already deployed by you on `10.1.10.42`:
- `Skyvern RPA (after deployment)` → port 8000 ✅
- `n8n Wolf Machine (after deployment)` → port 5678 ✅

Pending bring-up:
- Crawl4AI → port 11235
- Mem0 → port 8080
- Pipecat → port 7860
- OpenHands → port 3010

`hermes/agents/install-global.sh` brings the rest up; or run on the same
Wolf Machine box. Compose's port bindings can be moved if those ports
are taken.

## Live automation (running nightly via pg_cron)

Already turned on, no action needed:

| pg_cron job                       | Schedule       | Function                             |
|-----------------------------------|----------------|--------------------------------------|
| `hermes-dm-cross-sell-daily`      | `30 6 * * *`   | `fn_detect_dm_cross_sells()`         |
| `hermes-vault-cross-sell-daily`   | `31 6 * * *`   | `fn_detect_vault_cross_sells()`      |

Each function: SECURITY INVOKER, search_path pinned, EXECUTE granted to
`service_role` only, idempotent via `NOT EXISTS` on
`(client_id, missing_lobs)`, strict email-only client lookup (ambiguous
matches skipped). Inspect via `SELECT * FROM v_dm_cross_sell_candidates`
for a dry-run preview.

## Pre-existing security issue (flagging for your decision)

The `public.credentials` table has two RLS policies that pre-date this work:

| Policy | Roles | Effect |
|---|---|---|
| `admins_full_access` | `authenticated` | Any logged-in JWT can `SELECT api_key, api_secret` from every credential. |
| `service_role_all` | PUBLIC | `polroles={-}` is `PUBLIC` — effectively unrestricted. |

**Impact**: anyone with the anon or authenticated JWT can read every key
the stack uses. Not introduced by Hermes but worth fixing before
populating sensitive new keys (Vapi private, GitHub PATs, etc).

**Recommended fix** (review before applying — could break the admin UI's
read path until the UI is moved to `v_credentials_admin`):

```sql
DROP POLICY IF EXISTS admins_full_access ON public.credentials;
DROP POLICY IF EXISTS service_role_all   ON public.credentials;

CREATE POLICY service_role_all ON public.credentials
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT ON public.v_credentials_admin TO authenticated;
```

Then update the admin UI to read `v_credentials_admin` (presence flags
only) and write via a `SECURITY DEFINER` function so the JWT never
holds direct UPDATE on `credentials`.

## Open issues / parked items

These are real follow-ups that need either (a) a key from you or (b) an
external decision:

1. **Zapier Catch Hook URL** for Arive — referenced by lead-manager-crm
   handoff. Once you wire the Zap, paste URL into `arive_zapier_outbound_url`
   (currently in lead-manager-crm settings.json — not this repo).
2. **Cloudflare Turnstile keys** — the apply form widget is scaffolded
   but needs site/secret keys to activate.
3. **NMLS license number + Florida state license #** — placeholders in
   `licensing.html` (lead-manager-crm).
4. **WhatsApp owner decision** — Hermes gateway OR existing wa-bridge,
   not both. Documented as a hard rule in `hermes/README.md` and
   `agent-fleet` skill.
5. **n8n cross-sell webhook URL** — `N8N_WEBHOOK_ONBOARDING_URL` in
   `.env.example`. Set once your n8n flow is built.
6. **DOWNSTREAM_REPOS variable** — set on this GitHub repo with a
   JSON array of `owner/repo` entries to enable auto-propagation of the
   hermes/ overlay to other repos.
7. **GH_PAT_DOWNSTREAM_DISPATCH secret** — same; PAT with `repo:write`
   on every Ziarem repo.
8. **Rotate `arive_api_key` and `arive_zapier_inbound_secret`** that
   were pasted in plaintext during the lead-manager-crm handoff.

## Quick health-check command

On the VPS, after `bash hermes/agents/install-global.sh`:

```bash
bash hermes/agents/doctor.sh
hermes -z "use ziarem-status to give me a one-paragraph state-of-the-business"
hermes -z "use cross-sell-unstick to list the top 5 stuck opportunities"
hermes -z "use marketing-revive to tell me why no email has gone out in 30 days"
hermes -z "use hermes-keys to list every empty credential by category"
```
