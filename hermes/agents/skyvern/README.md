# Skyvern — browser automation for Ziarem

Best-in-class form-fill / portal-login agent (top of WebVoyager-WRITE).
Computer-vision based, so it survives portal redesigns. Self-hosted is
free; managed is $0.10/page.

**Priority use case in Ziarem: Wolf Insurance carrier portals.**

## Install (self-hosted)

```bash
git clone https://github.com/Skyvern-AI/skyvern.git /opt/skyvern
cd /opt/skyvern
cp .env.example .env
# Set: ANTHROPIC_API_KEY or OPENAI_API_KEY, BROWSER_TYPE=chromium-headful
docker-compose up -d
```

Health check:
```bash
curl http://localhost:8000/api/v1/heartbeat
```

## Wire to Hermes

```bash
hermes mcp add skyvern \
  --url http://localhost:8000/mcp \
  --bearer "$SKYVERN_API_KEY"
```

## Wire to Ziarem

The repo already has `public.skyvern_tasks` (and `bind_requests`,
`ws_carrier_quotes`, `ws_claims`, `dm_vendor_logins`) — Skyvern writes
results back to those tables. Add a row to `vault_api_configs` for the
Skyvern endpoint so the rest of the stack uses one source of truth:

```sql
INSERT INTO vault_api_configs (name, base_url, api_key, active)
VALUES ('skyvern', 'http://skyvern.internal:8000', '<key>', true);
```

## Wolf Insurance workflows

The `workflows/` folder has Skyvern workflow definitions tuned to the
`ws_*` schema and the `carriers` (85) + `carrier_appetite` (59) tables:

| File                        | What it does                                              | Writes to                  |
| --------------------------- | --------------------------------------------------------- | -------------------------- |
| `ws-quote-pull.yaml`        | Pull a quote from one carrier portal for one risk profile | `ws_carrier_quotes`        |
| `ws-quote-fanout.yaml`      | Fan out quote-pull across all carriers in `carrier_appetite` matching the risk | `ws_carrier_quotes`        |
| `ws-bind-submit.yaml`       | Submit a bind request to the chosen carrier              | `binds`, `bind_requests`   |
| `ws-claim-status.yaml`      | Daily sweep: claim status for every open `ws_claims` row | `ws_claims`                |
| `ws-policy-renewal.yaml`    | Pull renewal terms 60d before expiry                      | `ws_policies`, `renewals`  |
| `ws-license-verify.yaml`    | Quarterly: re-verify producer licenses per state DOI     | `pro_licenses`, `license_verification_logs` |

Each workflow accepts inputs via `skyvern_jobs` rows (status =
`Pending`) and updates them on completion. **Do not confuse with**
`ws_outbound_queue`, which is the existing Wolf Surety voice-call
queue (Twilio/Vapi outbound dialing) — different table, different
purpose.

### Suggested rollout (one carrier at a time)

1. Pick the most-used carrier from `carrier_win_rates` (top 3 by win rate).
2. Run `ws-quote-pull` against it manually with one test risk profile.
3. Eyeball the resulting `ws_carrier_quotes` row.
4. Promote to cron via `hermes cron add` once accuracy is >95% on 20 runs.
5. Repeat for the next carrier.

Don't fan out to all 85 carriers on day one — Skyvern's strength is also
its risk: it'll happily fill forms wrong if the prompt is sloppy.

## Cron pattern

```bash
hermes cron add \
  --name "ws-quote-fanout-hourly" \
  --schedule "0 * * * *" \
  --skill ws-quote-fanout \
  --args '{"queue_status":"Pending","limit":10}'
```

## Hard rules

- Skyvern runs in **headful** Chromium for portals that fingerprint
  headless. Run on a VPS with a virtual display (Xvfb) or use the
  managed service.
- Never put a carrier password in the workflow YAML. Reference
  `vault_api_configs` rows by name; Skyvern resolves them at runtime
  via the credentials API.
- Keep `ws-bind-submit` behind a manual approval step in `bind_requests`
  (status `PendingApproval` → `Approved` before Skyvern picks it up).
  Auto-binding is a financial-loss vector.
- Never let Skyvern access `cbw_ofac_sdn_list` or any sanctions data
  via a portal — those are compliance-controlled paths.
