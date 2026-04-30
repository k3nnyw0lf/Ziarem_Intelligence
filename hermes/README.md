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
