#!/usr/bin/env bash
# Recommended Hermes cron entries for the agent fleet.
# Run this once per VPS after `bash hermes/agents/install-global.sh` is green.
# Idempotent: `hermes cron add` skips entries that already exist by name.

set -euo pipefail

echo "→ Registering Ziarem fleet crons"

# ─── Skyvern / Wolf Insurance ───────────────────────────────────────────────
hermes cron add \
  --name "ws-quote-fanout-hourly" \
  --schedule "0 * * * *" \
  --skill ws-quote-fanout \
  --args '{"max_carriers":5}' || true

hermes cron add \
  --name "ws-claim-status-daily" \
  --schedule "30 6 * * *" \
  --skill ws-claim-status || true

hermes cron add \
  --name "ws-policy-renewal-nightly" \
  --schedule "0 2 * * *" \
  --skill ws-policy-renewal || true

hermes cron add \
  --name "ws-license-verify-quarterly" \
  --schedule "0 3 1 1,4,7,10 *" \
  --skill ws-license-verify || true

# ─── Crawl4AI / intel ───────────────────────────────────────────────────────
hermes cron add --name "crawl4ai-hourly" --schedule "5 * * * *"  --skill crawl4ai-fanout || true
hermes cron add --name "crawl4ai-daily"  --schedule "10 4 * * *" --skill crawl4ai-fanout || true
hermes cron add --name "crawl4ai-weekly" --schedule "20 4 * * 1" --skill crawl4ai-fanout || true

# ─── apps.yaml self-extend (local mirror of the GH Action, runs even on
# weekends when CI is paused).
hermes cron add \
  --name "hermes-discover-apps" \
  --schedule "0 6 * * 1" \
  --shell "cd $ZIAREM_HOME && node scripts/discover-apps.cjs" || true

echo "✓ Crons registered. List with:  hermes cron list"
