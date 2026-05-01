# Crawl4AI — research / competitive intel

Open-source crawler that uses an LLM to keep only the relevant content
(58k+ stars, free). Perfect for filling the empty intel tables Ziarem
already has.

## Global service

In `hermes/agents/docker-compose.yml`, bound to **11235**.

```bash
curl http://localhost:11235/health
```

## What to point it at (Ziarem-specific)

| Source                         | Frequency | Writes to              |
| ------------------------------ | --------- | ---------------------- |
| Top 20 competitor brokerage blogs | weekly | `competitive_intel`    |
| State DOI rate filings         | weekly    | `cbw_market_data`      |
| Mortgage rate aggregators      | daily     | `m0_rate_snapshots`    |
| HN / GH trending dev tools     | weekly    | `oss_radar_tools`      |
| Probate court filings (per county) | daily | `ph_probate_records`   |
| Foreclosure listings           | daily     | `ff_properties`        |

Feed source URLs from a config table:

```sql
CREATE TABLE IF NOT EXISTS crawl4ai_sources (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  url         text NOT NULL,
  cadence     text NOT NULL,             -- 'daily' | 'weekly' | 'hourly'
  target_table text NOT NULL,
  target_app  text NOT NULL,             -- references hermes/apps.yaml prefix
  extract_hint text,                     -- LLM steering hint
  active      boolean DEFAULT true
);
```

Then a cron skill `hermes/skills/crawl4ai-fanout/SKILL.md` reads this
table and dispatches one Crawl4AI job per active row.

## Hard rules

- Always write through the app prefix (`competitive_intel`, `oss_*`,
  `m0_*`) — never let Crawl4AI write to a `vault_*` or `re4lty_*` table
  directly. Cross-prefix writes go through Hermes with explicit
  approval.
- Set `User-Agent: Ziarem-Crawl4AI/1.0 (+contact@ziarem.com)` and
  honor `robots.txt`. Public-internet manners.
- Don't crawl carrier portals from here — that's Skyvern's job (auth +
  session continuity matter).
