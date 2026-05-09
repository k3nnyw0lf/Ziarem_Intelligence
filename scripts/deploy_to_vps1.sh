#!/usr/bin/env bash
# Deploy Ziarem Intelligence to VPS1 (alongside n8n + Cypht).
# Run from your local machine after committing + pushing to GitHub.
# Requires: SSH key id_ed25519_hostinger configured for root@72.62.174.114.
#
# Usage:
#   bash scripts/deploy_to_vps1.sh
#
# What it does:
#   1. SSH to VPS1
#   2. git clone (or pull) Ziarem_Intelligence into /docker/ziarem
#   3. Bootstrap .env from template (you edit it once)
#   4. docker compose up -d --build
#   5. Verify /health
#
# Idempotent — safe to re-run after `git push`.

set -euo pipefail

VPS_HOST="${VPS_HOST:-72.62.174.114}"
VPS_USER="${VPS_USER:-root}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_hostinger}"
REMOTE_DIR="/docker/ziarem"
GIT_REPO="https://github.com/k3nnyw0lf/Ziarem_Intelligence.git"
BRANCH="${BRANCH:-main}"

ssh_exec() {
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$VPS_USER@$VPS_HOST" "$@"
}

echo "==> Ensuring $REMOTE_DIR exists"
ssh_exec "mkdir -p $REMOTE_DIR && cd $REMOTE_DIR && (git -C $REMOTE_DIR rev-parse --is-inside-work-tree >/dev/null 2>&1 && git fetch origin $BRANCH && git reset --hard origin/$BRANCH) || git clone -b $BRANCH $GIT_REPO ."

echo "==> Checking .env exists (you must populate before first deploy)"
ssh_exec "test -f $REMOTE_DIR/.env || (cp $REMOTE_DIR/.env.example $REMOTE_DIR/.env && echo 'CREATED .env from template — EDIT IT then re-run this script.' && exit 1)"

echo "==> Building + starting via docker compose"
ssh_exec "cd $REMOTE_DIR && docker compose up -d --build"

echo "==> Waiting for /health"
for i in 1 2 3 4 5 6 7 8 9 10; do
  if ssh_exec "curl -fs http://localhost:3001/health >/dev/null"; then
    echo "==> ziarem-api healthy"
    break
  fi
  sleep 3
done

echo "==> Final container state"
ssh_exec "docker ps --filter name=ziarem --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"

echo "==> Logs (last 20 lines)"
ssh_exec "docker logs --tail 20 ziarem-api 2>&1 || true"

echo
echo "Done. API at https://ziarem-api.srv1257040.hstgr.cloud (once DNS + Traefik settle)."
echo "Next: point n8n HTTP nodes at \$ZIAREM_HOST/inbox/webhook/n8n (see N8N_INTEGRATION.md)."
