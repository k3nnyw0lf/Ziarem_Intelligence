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

2. **Apply the Ziarem CLI config** on top of the default. The example file
   sets Gemini as the primary provider (matches the rest of the stack),
   wires the gateway channels we actually use, and points Hermes at our
   Postgres so it can answer lead questions.

   ```bash
   cp hermes/config.example.yaml ~/.hermes/config.yaml
   ```

3. **Load the domain context** so Hermes knows the schema and business
   rules without being told every turn.

   ```bash
   cat hermes/ziarem-soul.md >> ~/.hermes/SOUL.md
   ```

4. **Pick a model & provider** (interactive):

   ```bash
   hermes model
   ```

5. **Start the messaging gateway** (Telegram/WhatsApp/Slack/Email):

   ```bash
   hermes gateway setup     # paste tokens
   hermes gateway run       # foreground (use `start` for systemd service)
   ```

6. **Test from the CLI** before exposing to operators:

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
