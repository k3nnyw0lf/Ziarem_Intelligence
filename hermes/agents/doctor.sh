#!/usr/bin/env bash
# Ziarem fleet doctor. Verifies the whole hermes + agent stack is wired
# up. Read-only — never starts/stops services. Run any time.
#
# Exit code reflects severity:
#   0  all green
#   1  warnings (something missing but not broken)
#   2  errors  (a service is down or unreachable)
#
# Usage:
#   bash hermes/agents/doctor.sh
#   bash hermes/agents/doctor.sh --json    # machine-readable summary

# Diagnostics — keep going through every check even if some fail.
set -uo pipefail

JSON=false
[[ "${1:-}" == "--json" ]] && JSON=true

red()    { printf '\033[31m%s\033[0m' "$1"; }
green()  { printf '\033[32m%s\033[0m' "$1"; }
yellow() { printf '\033[33m%s\033[0m' "$1"; }
dim()    { printf '\033[2m%s\033[0m'  "$1"; }

errors=0
warns=0
results=()

# ─── Helper: probe a URL with a 3s timeout ─────────────────────────────────
probe() {
  local name="$1" url="$2"
  if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then
    results+=("ok|$name|$url")
  else
    results+=("err|$name|$url")
    errors=$((errors+1))
  fi
}

# ─── Helper: check a binary is on PATH ─────────────────────────────────────
need() {
  local bin="$1"
  if command -v "$bin" >/dev/null 2>&1; then
    results+=("ok|cli:$bin|$(command -v "$bin")")
  else
    results+=("err|cli:$bin|missing")
    errors=$((errors+1))
  fi
}

# ─── 1. CLIs ───────────────────────────────────────────────────────────────
need hermes
need docker
need curl
need jq

# ─── 2. Docker fleet status ───────────────────────────────────────────────
if command -v docker >/dev/null 2>&1; then
  for svc in skyvern crawl4ai mem0 mem0-postgres pipecat openhands; do
    state=$(docker inspect --format '{{.State.Status}}' "ziarem-agents-${svc}-1" 2>/dev/null \
            || docker inspect --format '{{.State.Status}}' "${svc}" 2>/dev/null \
            || echo "missing")
    if [ "$state" = "running" ]; then
      results+=("ok|docker:$svc|running")
    elif [ "$state" = "missing" ]; then
      results+=("warn|docker:$svc|not deployed")
      warns=$((warns+1))
    else
      results+=("err|docker:$svc|$state")
      errors=$((errors+1))
    fi
  done
fi

# ─── 3. Health endpoints ───────────────────────────────────────────────────
probe "health:skyvern"   "http://localhost:8000/api/v1/heartbeat"
probe "health:crawl4ai"  "http://localhost:11235/health"
probe "health:mem0"      "http://localhost:8080/health"
probe "health:pipecat"   "http://localhost:7860/health"
probe "health:openhands" "http://localhost:3010/"   # openhands UI returns 200 on /

# ─── 4. Hermes MCP registration ───────────────────────────────────────────
if command -v hermes >/dev/null 2>&1; then
  mcp_list=$(hermes mcp list 2>/dev/null || echo "")
  for mcp in skyvern crawl4ai mem0 pipecat openhands; do
    if echo "$mcp_list" | grep -q "^${mcp}\b"; then
      results+=("ok|mcp:$mcp|registered")
    else
      results+=("warn|mcp:$mcp|not registered (run install-global.sh)")
      warns=$((warns+1))
    fi
  done

  # ─── 5. Hermes cron registration ─────────────────────────────────────────
  cron_list=$(hermes cron list 2>/dev/null || echo "")
  for c in ws-quote-fanout-hourly ws-claim-status-daily \
           ws-policy-renewal-nightly ws-license-verify-quarterly \
           crawl4ai-hourly crawl4ai-daily crawl4ai-weekly \
           hermes-discover-apps; do
    if echo "$cron_list" | grep -q "$c"; then
      results+=("ok|cron:$c|scheduled")
    else
      results+=("warn|cron:$c|not scheduled (run agents/cron.example.sh)")
      warns=$((warns+1))
    fi
  done

  # ─── 6. Required env keys (presence, not values) ─────────────────────────
  env_file="${HERMES_HOME:-$HOME/.hermes}/.env"
  if [ -f "$env_file" ]; then
    for key in GEMINI_API_KEY PGHOST PGUSER PGPASSWORD PGDATABASE; do
      if grep -q "^${key}=" "$env_file" && [ -n "$(grep "^${key}=" "$env_file" | cut -d= -f2-)" ]; then
        results+=("ok|env:$key|set")
      else
        results+=("warn|env:$key|empty in $env_file")
        warns=$((warns+1))
      fi
    done
  else
    results+=("err|env:file|$env_file missing")
    errors=$((errors+1))
  fi

  # ─── 7. apps.yaml in sync? ───────────────────────────────────────────────
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  if [ -f "$here/hermes/apps.yaml" ]; then
    n=$(grep -c '^[a-z][a-z0-9_]*:$' "$here/hermes/apps.yaml" || echo 0)
    results+=("ok|apps:registered|$n apps")
  else
    results+=("warn|apps:registered|hermes/apps.yaml missing")
    warns=$((warns+1))
  fi
fi

# ─── Output ────────────────────────────────────────────────────────────────
if [ "$JSON" = true ]; then
  printf '{"errors":%d,"warns":%d,"results":[' "$errors" "$warns"
  first=true
  for line in "${results[@]}"; do
    IFS='|' read -r status name detail <<<"$line"
    [ "$first" = true ] || printf ','
    first=false
    printf '{"status":"%s","name":"%s","detail":"%s"}' "$status" "$name" "$detail"
  done
  printf ']}\n'
else
  echo
  for line in "${results[@]}"; do
    IFS='|' read -r status name detail <<<"$line"
    case "$status" in
      ok)   printf '  %s  %-32s %s\n' "$(green ✓)" "$name" "$(dim "$detail")" ;;
      warn) printf '  %s  %-32s %s\n' "$(yellow ⚠)" "$name" "$detail" ;;
      err)  printf '  %s  %-32s %s\n' "$(red ✗)"   "$name" "$detail" ;;
    esac
  done
  echo
  ok_count=$(printf '%s\n' "${results[@]}" | grep -c '^ok|' 2>/dev/null || echo 0)
  echo "Summary: $(green "$ok_count ok")  $(yellow "$warns warn")  $(red "$errors err")"
fi

if [ "$errors" -gt 0 ]; then exit 2; fi
if [ "$warns"  -gt 0 ]; then exit 1; fi
exit 0
