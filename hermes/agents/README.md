# Ziarem agent fleet (Hermes-orchestrated)

Hermes is the orchestrator. These are the **specialist agents** Hermes
delegates to, exposed as MCP servers. Each one does one thing well:

| Agent       | Job                                              | Status in Ziarem                                  |
| ----------- | ------------------------------------------------ | ------------------------------------------------- |
| Skyvern     | Browser automation — vendor portals, RPA         | **Priority** — Wolf Insurance carrier portals     |
| OpenHands   | Issue-driven coding agent (overnight PRs)        | One per repo, GitHub Action driven                |
| Mem0        | Per-customer durable memory across surfaces      | Bridges `vault_ken_ai_memory`, `ai_chat_sessions` |
| Pipecat     | Voice pipeline composer over Vapi/Retell         | Mid-call hand-off + bilingual switching           |
| Crawl4AI    | Research / competitive intel scraper             | Fills `competitive_intel`, `oss_*`, market data   |

## Install order

1. **Skyvern** — see [skyvern/README.md](skyvern/README.md). Docker
   compose, then `hermes mcp add skyvern`. Wolf Insurance workflows are
   in `skyvern/workflows/`.
2. **Crawl4AI** — see [crawl4ai/README.md](crawl4ai/README.md). Docker.
3. **Mem0** — see [mem0/README.md](mem0/README.md). Hosted or
   self-hosted Postgres + pgvector.
4. **Pipecat** — see [pipecat/README.md](pipecat/README.md). Python
   service alongside Vapi.
5. **OpenHands** — see [openhands/README.md](openhands/README.md).
   GitHub Action template per repo.

## Common pattern

```
   ┌──────────┐         ┌──────────┐
   │ Operator │ ─Slack→ │  Hermes  │ ── delegates ──┐
   └──────────┘         └──────────┘                │
                              │                     ▼
                              │              ┌──────────┐
                              │              │ Skyvern  │ → vendor portals
                              │              └──────────┘
                              │              ┌──────────┐
                              ├─────MCP─────→│ Mem0     │ → vault_ken_ai_memory
                              │              └──────────┘
                              │              ┌──────────┐
                              │              │ Crawl4AI │ → competitive_intel
                              │              └──────────┘
                              │              ┌──────────┐
                              └─────────────→│ Pipecat  │ → Vapi mid-call
                                             └──────────┘
```

Each agent registers as an MCP server, so adding a new one is:
```bash
hermes mcp add <name>
```
and dropping a `SKILL.md` in `hermes/skills/<name>/` so Hermes knows when
to call it.

## Ports / conventions

| Service   | Port  | Health endpoint           |
| --------- | ----- | ------------------------- |
| Skyvern   | 8000  | `/api/v1/heartbeat`       |
| Crawl4AI  | 11235 | `/health`                 |
| Mem0      | 8080  | `/health` (self-hosted)   |
| Pipecat   | 7860  | `/health`                 |
| OpenHands | 3000  | runtime container         |

Never co-locate on a port already used by Ziarem (Next.js 3000, Node API
3001, swarm WS 3100). OpenHands defaults to 3000 — bind it to 3010 in
production.
