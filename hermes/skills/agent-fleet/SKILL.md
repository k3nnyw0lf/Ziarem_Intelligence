---
name: agent-fleet
description: Use this skill BEFORE answering any task that needs browser automation, durable memory, voice-call work, research/scraping, or autonomous coding. Ziarem runs five specialist agents (Skyvern, Crawl4AI, Mem0, Pipecat, OpenHands) as MCP servers. This skill tells you which one to delegate to. Trigger when the user mentions: a vendor portal, carrier login, "fill out the form", "remember this customer", a phone call, research / scrape / monitor, "fix this issue / open a PR", or any task larger than a one-shot SQL question.
---

# Agent fleet routing

| Need                                        | Use         | MCP name      |
| ------------------------------------------- | ----------- | ------------- |
| Log into a vendor / carrier portal          | Skyvern     | `skyvern`     |
| Pull a Wolf Insurance quote                 | Skyvern     | `skyvern`     |
| File-and-forget weekly research crawl       | Crawl4AI    | `crawl4ai`    |
| "Remember the customer said X"              | Mem0        | `mem0`        |
| Mid-call language switch / human transfer   | Pipecat     | `pipecat`     |
| Fix a labeled GitHub issue → draft PR       | OpenHands   | `openhands`   |

## How to delegate

1. Identify the agent from the table above.
2. Call its MCP tool — e.g. `skyvern.run_workflow(name='ws-quote-pull', ...)`.
3. Watch the queue / job ID; poll status until done or failed.
4. Summarize for the user — never dump raw agent output unless asked.

## Wolf Insurance fast paths

The `ws_*` tables + `carriers` + `carrier_appetite` are wired to
Skyvern workflows under `hermes/agents/skyvern/workflows/`:

- "pull a quote" → `ws-quote-pull.yaml`
- "shop this risk to all matching carriers" → `ws-quote-fanout.yaml`
- "what's the status on claim N" → `ws-claim-status.yaml`
- "renewal coming up" → `ws-policy-renewal.yaml`
- "verify producer license" → `ws-license-verify.yaml`

Always check `skyvern_jobs` for an existing Pending row matching the
workflow + carrier + quote_request before enqueuing — duplicate queue
entries cause portal rate-limit bans. Note: `skyvern_jobs` is the
Skyvern dispatch queue; `ws_outbound_queue` is the Wolf Surety
voice-call queue (Twilio/Vapi). Don't write to the wrong one.

## Hard rules

- Never auto-bind insurance — `ws-bind-submit.yaml` requires
  `bind_requests.status = 'Approved'` first.
- Mem0 is per-customer, not per-call. Use stable IDs from
  `v_customer_identities`, not session IDs.
- OpenHands writes to feature branches, never `main`.
- Pipecat must respond within 300ms; if your delegation chain exceeds
  that, do the work async and return a "checking..." TTS first.
- Crawl4AI honors robots.txt; Skyvern bypasses it by design — pick the
  right tool for the source.
