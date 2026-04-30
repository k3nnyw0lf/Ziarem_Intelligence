#!/usr/bin/env bash
# Install the Ziarem Hermes adapter into another repo.
#
# Run this from inside any other Ziarem GitHub repo (vault, re4lty, dm,
# cbw, ws, ziarem, etc.) to drop in the same hermes/ overlay this repo
# uses. The Hermes binary itself is installed once per machine — this
# script only adds the per-repo config + skill.
#
# Usage (from the target repo's root):
#   curl -fsSL https://raw.githubusercontent.com/k3nnyw0lf/Ziarem_Intelligence/main/scripts/install-hermes-into-repo.sh | bash
#
# Or with a custom app slug (matches an entry in apps.yaml):
#   APP_SLUG=re4lty bash install-hermes-into-repo.sh

set -euo pipefail

SOURCE_REPO="${SOURCE_REPO:-https://raw.githubusercontent.com/k3nnyw0lf/Ziarem_Intelligence/main}"
APP_SLUG="${APP_SLUG:-}"

if [ ! -d .git ]; then
  echo "✗ Run this from the root of a git repo." >&2
  exit 1
fi

echo "→ Fetching Ziarem hermes overlay from $SOURCE_REPO"

mkdir -p hermes hermes/skills

for f in README.md config.example.yaml env.example ziarem-soul.md apps.yaml; do
  echo "  · hermes/$f"
  curl -fsSL "$SOURCE_REPO/hermes/$f" -o "hermes/$f"
done

echo "  · hermes/skills/ziarem-apps/SKILL.md"
mkdir -p hermes/skills/ziarem-apps
curl -fsSL "$SOURCE_REPO/hermes/skills/ziarem-apps/SKILL.md" -o hermes/skills/ziarem-apps/SKILL.md

echo "  · hermes/skills/agent-fleet/SKILL.md (Skyvern/Mem0/Pipecat/Crawl4AI/OpenHands routing)"
mkdir -p hermes/skills/agent-fleet
curl -fsSL "$SOURCE_REPO/hermes/skills/agent-fleet/SKILL.md" -o hermes/skills/agent-fleet/SKILL.md

echo "  · hermes/agents/ (fleet docs, docker-compose, Wolf Insurance Skyvern workflows)"
mkdir -p hermes/agents/skyvern/workflows hermes/agents/openhands hermes/agents/mem0 hermes/agents/pipecat/pipelines hermes/agents/crawl4ai
for f in \
    "agents/README.md" \
    "agents/.env.example" \
    "agents/docker-compose.yml" \
    "agents/install-global.sh" \
    "agents/skyvern/README.md" \
    "agents/skyvern/workflows/ws-quote-pull.yaml" \
    "agents/skyvern/workflows/ws-quote-fanout.yaml" \
    "agents/skyvern/workflows/ws-claim-status.yaml" \
    "agents/openhands/README.md" \
    "agents/mem0/README.md" \
    "agents/pipecat/README.md" \
    "agents/pipecat/Dockerfile" \
    "agents/pipecat/server.py" \
    "agents/crawl4ai/README.md" \
  ; do
  curl -fsSL "$SOURCE_REPO/hermes/$f" -o "hermes/$f" || true
done
chmod +x hermes/agents/install-global.sh 2>/dev/null || true

echo "  · .claude/skills/hermes/SKILL.md"
mkdir -p .claude/skills/hermes
curl -fsSL "$SOURCE_REPO/.claude/skills/hermes/SKILL.md" -o .claude/skills/hermes/SKILL.md
curl -fsSL "$SOURCE_REPO/.claude/skills/hermes/journal.md" -o .claude/skills/hermes/journal.md

echo "  · .github/workflows/hermes-pull.yml (auto-sync from canonical)"
mkdir -p .github/workflows
curl -fsSL "$SOURCE_REPO/hermes/downstream-workflow.yml" -o .github/workflows/hermes-pull.yml

echo "  · scripts/install-hermes-into-repo.sh (self-update)"
mkdir -p scripts
curl -fsSL "$SOURCE_REPO/scripts/install-hermes-into-repo.sh" -o scripts/install-hermes-into-repo.sh
chmod +x scripts/install-hermes-into-repo.sh

if [ -n "$APP_SLUG" ]; then
  echo "→ Pinning APP_SLUG=$APP_SLUG into hermes/.app"
  echo "$APP_SLUG" > hermes/.app
fi

echo
echo "✓ Hermes overlay installed."
echo

# Detect whether the global agent fleet (Skyvern, Crawl4AI, Mem0, Pipecat,
# OpenHands) is already up on this machine. If not, point the user at it.
FLEET_OK=true
for url in \
  "http://localhost:8000/api/v1/heartbeat" \
  "http://localhost:11235/health"          \
  ; do
  if ! curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
    FLEET_OK=false
    break
  fi
done

echo "Next steps:"
echo "  1. command -v hermes || curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash"
echo "  2. cp hermes/env.example ~/.hermes/.env && \$EDITOR ~/.hermes/.env"
echo "  3. Merge hermes/config.example.yaml into ~/.hermes/config.yaml (model, platform_toolsets, providers)"
echo "  4. cat hermes/ziarem-soul.md >> ~/.hermes/SOUL.md"
if [ "$FLEET_OK" = false ]; then
  echo "  5. Bring up the global agent fleet (one-time, machine-wide):"
  echo "       cp hermes/agents/.env.example hermes/agents/.env && \$EDITOR hermes/agents/.env"
  echo "       bash hermes/agents/install-global.sh"
else
  echo "  5. Global agent fleet detected (skyvern + crawl4ai healthy) — no action needed."
fi
echo "  6. git add hermes/ .claude/ scripts/ && git commit -m 'Add Ziarem Hermes adapter'"
