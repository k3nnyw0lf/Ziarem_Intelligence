---
name: hermes
description: Use this skill whenever the user wants to talk to the Ziarem Hermes Agent (NousResearch/hermes-agent) or run a one-shot communication task in this repo. Hermes owns the unified CLI/Telegram/Slack/WhatsApp/email gateway. This skill prefers the real `hermes` CLI, falls back to plain HTTP only when the agent is unavailable, and APPENDS one lesson per action to journal.md so future runs apply prior findings. Trigger on: "ask hermes", "run hermes", "send via hermes", "hermes gateway", "research", "fetch", "scrape", or any request that needs to reach a person or external service.
---

# Hermes — Ziarem communication skill

Hermes Agent is installed at `/usr/local/lib/hermes-agent` with the binary on
`$PATH` as `hermes`. Repo-side adaptation lives in `hermes/` (config, env,
SOUL extension). Don't reinvent — delegate.

## Decision tree

1. **Is `hermes` on PATH?** Run `command -v hermes`. If yes, prefer the CLI.
2. **One-shot task** (single question, no streaming): use
   `hermes -z "<prompt>"` and capture stdout.
3. **Interactive / multi-turn**: open `hermes chat` in a terminal — don't try
   to drive the TUI from here.
4. **Outbound message** (Telegram/Slack/WhatsApp/email): the gateway must be
   running (`hermes gateway status`). If not, tell the user — don't
   silently start a system service.
5. **Web research** with no Hermes available: fall back to `WebFetch` or
   `curl`, then `navigate`/`snapshot` if that fails.

## Workflow for every run

1. **Plan** — list the URLs / endpoints / channels you'll touch.
2. **Read `journal.md`** — apply prior lessons (e.g. "telegram bot rate-limits
   above 30 msg/s", "github.com article pages need browser fallback").
3. **Execute** — fewest tool calls that get the answer.
4. **Summarize** for the user.
5. **Learn** — append to `.claude/skills/hermes/journal.md`:

   ```
   ## YYYY-MM-DD HH:MM <one-line task>
   - surface: hermes-cli | webfetch | browser | gateway-<channel>
   - result: ok | failed (<reason>)
   - lesson: <what to do differently next time>
   ```

## Hard rules

- Never run `hermes setup`, `hermes gateway install`, `hermes login`, or
  `hermes auth` without explicit user instruction — they prompt for secrets
  and install system services.
- Never paste API keys or tokens into chat output, even from `~/.hermes/.env`.
- For repo-scoped GitHub work, prefer the GitHub MCP tools over Hermes.
- For bulk marketing email, route through `omni_sender.js`, not Hermes.
- Keep journal entries to <=4 lines — it's a lesson log, not a transcript.
