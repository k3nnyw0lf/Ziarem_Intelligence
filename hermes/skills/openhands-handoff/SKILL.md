---
name: openhands-handoff
description: Use this skill when the user asks you to "open an issue", "file a ticket", "have the agent fix this", or describes a bug/feature that isn't a one-shot fix. Files a GitHub issue with the `agent` label, which triggers the OpenHands workflow in the target repo and produces a draft PR overnight. Does NOT make code changes itself.
---

# OpenHands hand-off

Hermes is for live work. OpenHands is for **"file this and walk away."**
Use this skill to convert a verbal/Slack/Telegram request into a
properly-scoped GitHub issue that OpenHands can act on.

## Before filing

1. **Pick the right repo.** Use `hermes/apps.yaml` to map the user's app
   word ("vault", "re4lty", "wolf insurance") to the correct GitHub
   repo. If unclear, ask.
2. **Refuse vague tickets.** OpenHands does mediocre work on
   "make it better" prompts and good work on "in `<file>:<line>`,
   change X to Y because Z." If the request is vague, ask the user
   for one concrete acceptance criterion before filing.
3. **Check for duplicates.** Search open issues with the `agent` label
   for matching keywords. Comment-and-link rather than file twice.

## Issue template

```
Title: <terse imperative — "Add X to Y" / "Fix Z when W">

## Context
<one paragraph: where in the code, who hits it, what's the symptom>

## Acceptance criteria
- [ ] <observable, testable thing #1>
- [ ] <observable, testable thing #2>
- [ ] tests pass: `<exact command>`

## Out of scope
<things you DON'T want the agent to touch — refactors, unrelated dirs>

## Hint for the agent
<file paths, line numbers, or function names where the change probably lives>
```

Always set the `agent` label and assign to nobody. Do **not** attach
the milestone or epic — let humans do that on review.

## Hard rules

- **Never auto-file from a chat surface.** Telegram/Slack requests must
  echo the drafted issue to the user and wait for "ok" before posting.
- **Never file against `main`.** OpenHands creates feature branches
  itself; your job is the issue, not the branch.
- **Never include secrets** in the issue body — even hints. Reference
  `vault_api_configs` row names, never the keys themselves.
- **Mark `wontfix` if the agent already tried twice.** A skill that
  keeps re-filing the same failing ticket is worse than a missing
  feature.
