# Ziarem operations — live state

Snapshot of every Ziarem app and integration as of the Hermes install.
This file is the human counterpart to `hermes/skills/ziarem-status/SKILL.md`
(machine-readable status query that returns the same picture).

> Numbers below are from a live audit of Supabase project
> `sfelhasepvaoianyuvxe`. Re-run with `npm run hermes:fleet-doctor`
> on the VPS or `hermes -z "use ziarem-status"` from the CLI.

## Headline

Infrastructure is **configured but largely dormant**. 32 apps registered,
57 credential slots catalogued, but the operational surfaces (Vapi calls,
email blasts, cross-sell automation) aren't producing signal.

| Surface              | State     | Action                                         |
| -------------------- | --------- | ---------------------------------------------- |
| Marketing senders    | 27 active | Need a live campaign. See `marketing-revive`.  |
| Marketing campaigns  | 1 active, 5 sent, 8 drafted | Activate one or revive cron. |
| AI sales (Vapi)      | 0 calls / 7d | Verify `vault_ai_call_config` + Vapi webhook. |
| Cross-sell pipeline  | 15 stuck at `identified` | See `cross-sell-unstick`. |
| Lead intake          | 22 new (none qualified) | Lead scoring not advancing rows. |
| Telegram             | 3 configs active, 0 msgs / 7d | Bot not connected, or quiet week. |
| Skyvern (Wolf)       | Deployed at `10.1.10.42:8000` | 6 workflows ready; needs job queue rows. |

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

**44 keys** await values from the admin UI. Top 6 highest-leverage to fill:

1. `Google Gemini API` — Hermes default LLM. Without it, no agent reasoning.
2. `OpenAI API (shared by Crawl4AI/Mem0/Pipecat)` — three agents wired to one key.
3. `Vapi - AI Voice Calls` — without it, AI sales floor stays dark.
4. `Telegram Bot - Hermes Gateway` — fastest operator surface to come online.
5. `GitHub PAT - Hermes Skills Hub` — kills the 60 req/hr rate limit on skill installs.
6. `Cloudflare Turnstile - Apply Form` — apply form bot protection (referenced in lead-manager-crm).

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
