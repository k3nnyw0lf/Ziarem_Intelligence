# Hermes for Ziarem

[Hermes Agent](https://github.com/NousResearch/hermes-agent) is the unified
communication brain for Ziarem. It exposes one agent across CLI, Telegram,
Discord, Slack, WhatsApp, Signal, and email, and improves itself by writing
skills from experience.

This folder holds the Ziarem-specific config that adapts Hermes to our domain
(leads, calls, cross-sells) and our existing channels (`omni_sender.js`,
`wa-bridge`, n8n webhooks, Vapi/Retell).

## Install

One-liner (Linux/macOS/WSL2/Termux):

```bash
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
```

Sanity check:

```bash
hermes version
hermes doctor
```

## Adapt to Ziarem

1. **Copy the env template** into your Hermes home and fill it in. Hermes
   reads `~/.hermes/.env` on startup.

   ```bash
   cp hermes/env.example ~/.hermes/.env
   $EDITOR ~/.hermes/.env
   ```

   The template re-uses the same keys the rest of the repo already needs
   (`GEMINI_API_KEY`, `PG*`, `SUPABASE_*`, SMTP creds), so one source of
   truth.

2. **Apply the Ziarem CLI config** on top of the upstream default. Don't
   overwrite — the upstream file has 800+ lines of comments. Merge the
   keys from `hermes/config.example.yaml` into the matching sections of
   `~/.hermes/config.yaml`:

   ```bash
   $EDITOR hermes/config.example.yaml ~/.hermes/config.yaml
   # then merge model:, platform_toolsets:, platforms:, agent:, skills:, providers:
   ```

   What this overlay actually changes:
   - `model.{default,provider}` → Gemini 2.5 Pro (matches `GEMINI_API_KEY`).
   - `platform_toolsets` → Telegram/Slack/WhatsApp lose `terminal` + `file`
     write so chat surfaces can't shell out.
   - `platforms.telegram.extra.disable_link_previews: true`.
   - `agent.max_turns: 80`, `reasoning_effort: medium`.
   - `skills.external_dirs` includes `${ZIAREM_HOME}/hermes/skills` so
     repo-local skills load without copying.
   - `providers.{gemini,anthropic}.request_timeout_seconds`.

3. **Set the fallback chain** (CLI, not YAML):

   ```bash
   hermes fallback add   # pick OpenRouter / Anthropic as backup
   ```

4. **Load the domain context** so Hermes knows the schema and business
   rules without being told every turn.

   ```bash
   cat hermes/ziarem-soul.md >> ~/.hermes/SOUL.md
   ```

5. **Add MCP servers Ziarem already uses** (Postgres / Supabase / GitHub):

   ```bash
   hermes mcp add   # discovery-first install, picks from registry
   ```

6. **Pick a model & provider** if you didn't already:

   ```bash
   hermes model
   ```

7. **Start the messaging gateway** (Telegram/WhatsApp/Slack/Email):

   ```bash
   hermes gateway setup     # paste tokens
   hermes gateway run       # foreground (use `start` for systemd service)
   ```

8. **Test from the CLI** before exposing to operators:

   ```bash
   hermes -z "How many leads moved to Under Contract this week?"
   ```

## How it lines up with existing Ziarem code

| Ziarem path                  | Hermes equivalent                       | Migration note                                       |
| ---------------------------- | --------------------------------------- | ---------------------------------------------------- |
| `omni_sender.js` (SMTP)      | `hermes` email gateway + skills         | Keep `omni_sender.js` for bulk campaigns; use Hermes for 1:1 + reactive replies. |
| `imap_sync.js`               | Hermes email inbound (gateway)          | Hermes can route inbound mail to skills; keep `imap_sync.js` for archival sync. |
| `wa-bridge/`                 | `hermes whatsapp` integration           | Decide which one owns the WhatsApp number; don't run both against the same session. |
| n8n webhooks (cross-sell)    | `hermes webhook` + cron                 | Hermes can subscribe to webhooks and call back to n8n; n8n stays for long workflows. |
| Vapi/Retell call-end ingest  | unchanged                               | Hermes consumes the resulting `calls` rows via Postgres skill, not the raw transcript stream. |

## Agent fleet (global, all repos benefit)

Hermes is the orchestrator. The specialist agents live in
[`agents/`](agents/) as a single docker-compose fleet that you bring up
**once per VPS** — every Ziarem repo's Hermes reaches them via MCP, no
per-repo install needed.

```bash
cp hermes/agents/.env.example hermes/agents/.env && $EDITOR hermes/agents/.env
bash hermes/agents/install-global.sh
```

| Agent     | Port  | Job                                          | Wolf Insurance fit                   |
| --------- | ----- | -------------------------------------------- | ------------------------------------ |
| Skyvern   | 8000  | Browser/RPA — vendor portals, form fill      | **Primary**: `ws_*` workflows in `agents/skyvern/workflows/` |
| Crawl4AI  | 11235 | Research / competitive intel scraping        | Carrier rate filings, market data    |
| Mem0      | 8080  | Per-customer durable memory                  | Returning lead memory across surfaces |
| Pipecat   | 7860  | Voice pipeline composer over Vapi/Retell     | Bilingual EN/ES + claim escalation   |
| OpenHands | 3010  | Issue-driven coding agent                    | Per-repo PRs (e.g. `ws_*` schema migrations) |

See [`agents/README.md`](agents/README.md) for the architecture diagram
and [`agents/skyvern/README.md`](agents/skyvern/README.md) for the
Wolf Insurance rollout plan.

## Auto-sync (now and forever)

Two automations keep the overlay current without you re-running anything:

1. **`apps.yaml` self-extends.** `scripts/discover-apps.js` queries the
   shared Supabase Postgres for any table prefix it doesn't already know
   about, and `.github/workflows/hermes-sync.yml` runs it weekly + on
   manual dispatch. New prefixes show up as a PR with `vertical: other`
   and a `TODO:` marker for you to fill in.

   Run it locally any time:
   ```bash
   npm run hermes:discover
   ```

   Required GitHub secrets in this repo: `PGHOST`, `PGUSER`,
   `PGPASSWORD`, `PGDATABASE`.

2. **Downstream repos pull on every change.** When this repo's `hermes/`
   folder changes on `main`, the workflow fires a `repository_dispatch`
   to every entry in the `DOWNSTREAM_REPOS` repo variable (JSON array of
   `owner/repo`). Each downstream repo's `.github/workflows/hermes-pull.yml`
   (installed by `scripts/install-hermes-into-repo.sh`) reacts by
   re-running the install script and opening a sync PR.

   Required: a PAT with `repo:write` scope stored as
   `GH_PAT_DOWNSTREAM_DISPATCH` in this repo, and a
   `vars.DOWNSTREAM_REPOS` JSON list, e.g.
   `["k3nnyw0lf/vault","k3nnyw0lf/re4lty","k3nnyw0lf/dm"]`.

   Each downstream repo also has a daily cron in `hermes-pull.yml` as a
   safety net — they'll catch up even if a dispatch is missed.

## Multi-app coverage (Supabase + GitHub)

Every Ziarem product co-tenants in **one** Supabase project
(`sfelhasepvaoianyuvxe`) under a table prefix. The full app list lives in
[`apps.yaml`](apps.yaml) — `vault_*`, `re4lty_*`, `dm_*`, `cbw_*`, `ws_*`,
`ph_*`, `ff_*`, `ziarem_*`, `hha_*`, `health_*`, `auto_*`, `cc_*`, `cd_*`,
and so on.

The skill at `hermes/skills/ziarem-apps/SKILL.md` (loaded automatically via
`skills.external_dirs` in the config overlay) teaches Hermes to:

- match a question to one app's prefix,
- refuse to silently page across prefixes,
- honor anchor cross-sell relationships (`re4lty_*` → `dm_*` / `cbw_*` /
  `ws_*` / `vault_*`),
- ask for clarification when the prefix is ambiguous.

Add a new app:

```bash
$EDITOR hermes/apps.yaml   # append <slug>: { name, prefix, vertical, anchor, notes }
git commit -am "hermes: register <slug> app"
```

### Installing the same overlay into other GitHub repos

Each repo gets its own copy of the overlay — there's no central registry.
From the root of any other Ziarem repo run:

```bash
curl -fsSL https://raw.githubusercontent.com/k3nnyw0lf/Ziarem_Intelligence/main/scripts/install-hermes-into-repo.sh | bash
# optional: pin a specific app slug
APP_SLUG=re4lty bash <(curl -fsSL https://raw.githubusercontent.com/k3nnyw0lf/Ziarem_Intelligence/main/scripts/install-hermes-into-repo.sh)
```

The script drops `hermes/` and `.claude/skills/hermes/` into the target
repo, mirroring this one. The Hermes CLI itself is installed once per
machine — not per repo.

## Updating

```bash
hermes update
```

Roll our adaptation forward by re-merging `hermes/ziarem-soul.md` into
`~/.hermes/SOUL.md` and re-copying `hermes/config.example.yaml` if upstream
adds new keys.

## Troubleshooting

- `hermes doctor` — checks deps, API keys, gateway, memory.
- `hermes logs` — tails recent logs.
- `hermes dump` — full setup snapshot for support.
