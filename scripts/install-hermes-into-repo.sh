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
#
# Override source for testing against a feature branch:
#   SOURCE_REF=claude/install-hermes-8cwjy bash install-hermes-into-repo.sh

set -euo pipefail

SOURCE_OWNER="${SOURCE_OWNER:-k3nnyw0lf}"
SOURCE_REPO="${SOURCE_REPO:-Ziarem_Intelligence}"
SOURCE_REF="${SOURCE_REF:-main}"
APP_SLUG="${APP_SLUG:-}"

if [ ! -d .git ]; then
  echo "✗ Run this from the root of a git repo." >&2
  exit 1
fi

for bin in curl tar; do
  command -v "$bin" >/dev/null 2>&1 || { echo "✗ Missing $bin" >&2; exit 1; }
done

# rsync is preferred but optional — fall back to cp -r when missing.
HAS_RSYNC=true
command -v rsync >/dev/null 2>&1 || HAS_RSYNC=false

echo "→ Fetching $SOURCE_OWNER/$SOURCE_REPO @ $SOURCE_REF"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# codeload handles branch names with slashes (claude/install-hermes-8cwjy).
url="https://codeload.github.com/$SOURCE_OWNER/$SOURCE_REPO/tar.gz/$SOURCE_REF"
if ! curl -fsSL "$url" -o "$tmp/src.tar.gz"; then
  echo "✗ Couldn't fetch $url" >&2
  exit 1
fi

mkdir -p "$tmp/extract"
tar -xzf "$tmp/src.tar.gz" -C "$tmp/extract" --strip-components=1

# ─── Sync the overlay ──────────────────────────────────────────────────────
sync_dir() {
  local src="$tmp/extract/$1" dest="$2"
  [ -d "$src" ] || return 0
  mkdir -p "$dest"
  if [ "$HAS_RSYNC" = true ]; then
    rsync -a --delete-excluded "$src/" "$dest/"
  else
    cp -rT "$src" "$dest"
  fi
  echo "  · $2/"
}

sync_one() {
  local src="$tmp/extract/$1" dest="$2"
  [ -f "$src" ] || return 0
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
  echo "  · $dest"
}

# Bulk: every file under hermes/ (configs, agents, skills, workflows).
sync_dir hermes hermes

# Claude Code skill bundle
sync_dir .claude/skills/hermes .claude/skills/hermes

# Downstream auto-pull workflow (renamed from canonical's source name).
sync_one hermes/downstream-workflow.yml .github/workflows/hermes-pull.yml

# Self-updating installer copy.
sync_one scripts/install-hermes-into-repo.sh scripts/install-hermes-into-repo.sh
chmod +x scripts/install-hermes-into-repo.sh
chmod +x hermes/agents/install-global.sh 2>/dev/null || true
chmod +x hermes/agents/doctor.sh         2>/dev/null || true
chmod +x hermes/agents/cron.example.sh   2>/dev/null || true

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
  echo "  5. Global agent fleet detected — no action needed."
fi
echo "  6. bash hermes/agents/doctor.sh   # verify"
echo "  7. git add hermes/ .claude/ scripts/ .github/ && git commit -m 'Add Ziarem Hermes adapter'"
