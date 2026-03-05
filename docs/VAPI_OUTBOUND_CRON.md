# Vapi Outbound Cron & TCPA Pre-Scrub

## 1. Daily lead scoring

Run the score-leads API daily so `propensity_score` is up to date:

```bash
# Example cron (Hostinger / GitHub Actions): GET with optional auth
curl -X GET "https://ziarem.com/api/score-leads" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Set `CRON_SECRET` in env and pass it as `Authorization: Bearer <CRON_SECRET>` so only your cron can trigger the job.

## 2. Query cold leads for outbound (Whale order)

Before dispatching the batch to Vapi, run:

```sql
SELECT * FROM leads
WHERE status = 'Cold'
  AND parent_lead_id IS NULL
ORDER BY propensity_score DESC NULLS LAST
LIMIT 50;
```

Use these rows as the outbound list.

## 3. TCPA pre-scrub (scrubDNC)

Before sending the batch to Vapi, filter numbers through the litigation firewall:

```ts
import { scrubDNC } from "@/lib/compliance/scrubDNC";

const coldPhones = leadsFromQuery.map((r) => r.phone_number);
const safePhones = await scrubDNC(coldPhones);
// Only push safePhones to Vapi /call/outbound
```

- **Mock (default):** With no `TCPA_FIREWALL_URL` / `TCPA_FIREWALL_API_KEY`, `scrubDNC` returns all numbers (no real scrub).
- **Production:** Set `TCPA_FIREWALL_URL` and `TCPA_FIREWALL_API_KEY` to your TCPA firewall API. The function POSTs `{ phones: string[] }` and expects a response with `results[]` of `{ phone, safe_to_dial, reason? }`. Only numbers with `safe_to_dial: true` are returned.

## 4. End-to-end flow

1. Cron hits `GET /api/score-leads` (daily).
2. Outbound job runs (e.g. every hour): query cold leads by `propensity_score DESC LIMIT 50`.
3. Run `scrubDNC(phoneArray)` and keep only safe numbers.
4. For each safe number, call assemble-persona then Vapi `/call/outbound` with the returned `systemPrompt`.
