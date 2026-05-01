# OpenHands — issue-driven coding agent

Listens to GitHub issues labeled `agent` across every Ziarem repo and
opens draft PRs. Different shape than Claude Code (which is interactive
in your terminal); this one runs overnight against your backlog.

## Global service

Already in `hermes/agents/docker-compose.yml`. Bound to host port **3010**
(NOT 3000 — that's Next.js).

```bash
curl http://localhost:3010/health
```

## Per-repo wiring

Drop this GitHub Action into every repo that should be eligible. The
`hermes-pull.yml` auto-sync workflow already propagates this file via
`scripts/install-hermes-into-repo.sh`.

```yaml
# .github/workflows/openhands.yml
name: OpenHands agent
on:
  issues:
    types: [labeled]
jobs:
  agent:
    if: github.event.label.name == 'agent'
    runs-on: ubuntu-latest
    steps:
      - uses: docker://docker.all-hands.dev/all-hands-ai/openhands-runtime:latest
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN:      ${{ secrets.GITHUB_TOKEN }}
          ISSUE_NUMBER:      ${{ github.event.issue.number }}
          REPO:              ${{ github.repository }}
```

## Hard rules

- Label `agent` only issues with a clear acceptance criterion. Open-ended
  issues produce mediocre PRs and waste tokens.
- OpenHands runs Docker-in-Docker. On the VPS, mount
  `/var/run/docker.sock` (already in compose). Don't expose port 3010
  publicly.
- Never let OpenHands run against `main` directly — always a feature
  branch + draft PR.
