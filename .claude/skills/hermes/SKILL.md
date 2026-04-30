---
name: hermes
description: Use this skill for ANY external communication in this repo — outbound web fetches, news/article research, scraping, and contacting third-party services. Hermes plans steps, prefers fast HTTP fetches, falls back to a real browser when a fetch fails, and APPENDS what it learned to .claude/skills/hermes/journal.md after every action so the skill improves over time. Trigger when the user asks to "research", "fetch", "scrape", "summarize a page", "look up", or otherwise reach the network.
---

# Hermes — communication & research skill

Hermes is the messenger. When a task requires reaching outside the repo (web,
HN, GitHub, vendor docs, partner APIs), use Hermes instead of ad-hoc curls.

## Workflow

For every run, follow these steps and write the plan to the user before
executing:

1. **Plan** — list the URLs / endpoints you intend to hit and what you want
   from each. One line per step (e.g. `STEP 1: Fetch HN front page`).
2. **Try the fast path** — `WebFetch` for HTML/JSON, or `curl` via Bash for
   APIs. Capture the result.
3. **Fallback to browser** — if a fetch fails (403, JS-rendered page, empty
   body, anti-bot), retry with the browser MCP / `navigate` + `snapshot` tools.
   Note WHY the fast path failed in the journal.
4. **Summarize** — produce the user-visible answer. Keep it tight.
5. **Learn** — append a single entry to `.claude/skills/hermes/journal.md`:

   ```
   ## YYYY-MM-DD HH:MM <one-line task>
   - host: <example.com> — fast path: ok | failed (<reason>)
   - lesson: <what to do differently next time for this host / pattern>
   ```

   Before starting a new run, READ `journal.md` and apply prior lessons (e.g.
   "github.com article pages need browser fallback").

## Output format

When reporting back to the user, mirror this structure:

```
STEP 1: <action>
  <tool>  <target>  <status/timing>
  <one-line result>

STEP 2: ...
```

End with a numbered summary list when the task produced a list of items.

## Hard rules

- Never invent URLs. Use only URLs the user provided, ones present in repo
  files, or ones returned by a search tool.
- Never bypass auth, captchas, or rate limits.
- For GitHub URLs in this repo's allowed scope, prefer the GitHub MCP tools
  over WebFetch.
- Don't post to external services (Slack, GitHub comments, n8n webhooks)
  unless the user explicitly asked for that exact action.
- Keep journal entries to <=4 lines each — it's a lesson log, not a transcript.
