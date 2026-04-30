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
echo "Next steps:"
echo "  1. command -v hermes || curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash"
echo "  2. cp hermes/env.example ~/.hermes/.env && \$EDITOR ~/.hermes/.env"
echo "  3. Merge hermes/config.example.yaml into ~/.hermes/config.yaml (model, platform_toolsets, providers)"
echo "  4. cat hermes/ziarem-soul.md >> ~/.hermes/SOUL.md"
echo "  5. git add hermes/ .claude/ scripts/ && git commit -m 'Add Ziarem Hermes adapter'"
