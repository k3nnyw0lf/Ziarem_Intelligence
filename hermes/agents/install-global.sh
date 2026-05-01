#!/usr/bin/env bash
# Global install of the Ziarem agent fleet.
#
# Run ONCE per VPS. Every Ziarem repo's Hermes will reach these via MCP
# automatically, because Hermes' config lives at ~/.hermes/ (per-machine,
# not per-repo).
#
# Usage:
#   bash hermes/agents/install-global.sh
#   bash hermes/agents/install-global.sh --skip-docker     # if compose is already up
#   bash hermes/agents/install-global.sh --skip-mcp        # only bring up containers
#
# Idempotent: re-running adds the missing MCP entries and restarts containers.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKIP_DOCKER=false
SKIP_MCP=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-docker) SKIP_DOCKER=true; shift ;;
    --skip-mcp)    SKIP_MCP=true;    shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

echo "→ Ziarem agent fleet install (global)"
echo "  fleet root: $HERE"

# ─── 1. Hermes itself ───────────────────────────────────────────────────────
if ! command -v hermes >/dev/null 2>&1; then
  echo "  · installing hermes-agent (not on PATH)"
  curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
fi

# ─── 2. Env file ────────────────────────────────────────────────────────────
if [ ! -f "$HERE/.env" ]; then
  echo "✗ Missing $HERE/.env. Copy from .env.example and fill in keys, then re-run." >&2
  exit 1
fi

# ─── 3. Bring up the fleet ─────────────────────────────────────────────────
if [ "$SKIP_DOCKER" = false ]; then
  echo "→ docker compose up -d"
  ( cd "$HERE" && docker compose --env-file .env up -d --remove-orphans )

  echo "→ waiting for health checks (60s budget)"
  for _ in $(seq 1 30); do
    if curl -fsS http://localhost:8000/api/v1/heartbeat >/dev/null 2>&1 \
    && curl -fsS http://localhost:11235/health           >/dev/null 2>&1; then
      echo "  ✓ skyvern + crawl4ai healthy"
      break
    fi
    sleep 2
  done
fi

# ─── 4. Register MCP servers with Hermes (global, one-time) ────────────────
if [ "$SKIP_MCP" = false ]; then
  echo "→ registering MCP servers in ~/.hermes/"

  # shellcheck disable=SC1091
  source "$HERE/.env"

  add_mcp() {
    local name="$1"
    local url="$2"
    local bearer="${3:-}"
    if hermes mcp list 2>/dev/null | grep -q "^${name}\b"; then
      echo "  · $name already registered, skipping"
      return
    fi
    if [ -n "$bearer" ]; then
      hermes mcp add "$name" --url "$url" --bearer "$bearer"
    else
      hermes mcp add "$name" --url "$url"
    fi
    echo "  ✓ $name registered"
  }

  add_mcp skyvern   "http://localhost:8000/mcp"   "${SKYVERN_API_KEY:-}"
  add_mcp crawl4ai  "http://localhost:11235/mcp"  "${CRAWL4AI_API_TOKEN:-}"
  add_mcp mem0      "http://localhost:8080/mcp"
  add_mcp pipecat   "http://localhost:7860/mcp"
  add_mcp openhands "http://localhost:3010/mcp"
fi

# ─── 5. Wire repo-local skills into Hermes' external_dirs ──────────────────
# The skills folder lives in this repo at hermes/skills/. Adding the
# absolute path here makes every Ziarem repo's local skills loadable too,
# because Hermes resolves the same external_dirs for every CLI invocation.
ZIAREM_HOME="${ZIAREM_HOME:-$(cd "$HERE/../.." && pwd)}"
echo "→ ZIAREM_HOME=$ZIAREM_HOME"

if ! grep -q "$ZIAREM_HOME/hermes/skills" ~/.hermes/config.yaml 2>/dev/null; then
  echo "  · appending external_dirs entry to ~/.hermes/config.yaml"
  cat >> ~/.hermes/config.yaml <<EOF

# Ziarem agent fleet — added by hermes/agents/install-global.sh
skills:
  external_dirs:
    - "$ZIAREM_HOME/hermes/skills"
    - "$ZIAREM_HOME/hermes/agents/skyvern/workflows"
EOF
fi

echo
echo "✓ Global install complete."
echo
echo "Sanity check:"
echo "  hermes mcp list"
echo "  hermes doctor"
echo "  hermes -z 'use skyvern to pull a Wolf Insurance quote for the next pending row in skyvern_jobs'"
