---
name: crawl4ai-fanout
description: Use this skill to run the recurring research/intel crawl across every active row in crawl4ai_sources. Reads the registry, picks rows due per cadence, dispatches one Crawl4AI job per row via the crawl4ai MCP, and writes results to the configured target_table. Trigger on hermes cron (daily 04:00 + hourly 0 * * * for hourly sources) or manually with "refresh competitive intel", "run the weekly crawl", "scrape competitor changelogs".
---

# Crawl4AI fanout

`crawl4ai_sources` is the one source of truth for what to scrape, how
often, and where to write it.

## Run loop

1. **Pick due rows.**
   ```sql
   SELECT *
   FROM crawl4ai_sources
   WHERE active = true
     AND (last_run_at IS NULL
          OR (cadence = 'hourly'  AND last_run_at < now() - interval '1 hour')
          OR (cadence = 'daily'   AND last_run_at < now() - interval '1 day')
          OR (cadence = 'weekly'  AND last_run_at < now() - interval '7 days')
          OR (cadence = 'monthly' AND last_run_at < now() - interval '30 days'))
   ORDER BY last_run_at NULLS FIRST
   LIMIT 50;
   ```

2. **Per row, call Crawl4AI** with the URL and `extract_hint` as steering.
   Use the `crawl4ai` MCP tool — never raw `WebFetch` — so we get
   LLM-filtered content, not raw HTML.

3. **Validate the target table.** Refuse if `target_app` doesn't match a
   prefix in `hermes/apps.yaml` (prevents accidental writes outside a
   known app).

4. **Insert into `<target_table>`.** Map common fields (title, url,
   extracted_at, source_id) and stuff the rest into a `raw_jsonb`
   column if the table has one.

5. **Update `last_run_at` and `last_status`** (`ok` | `error: <msg>`).

## Hard rules

- Never write across more than one `target_app` per row. One crawl, one
  table, one prefix.
- Honor robots.txt — Crawl4AI does this by default; don't override.
- For carrier portals or anything behind login, abort and return
  "use Skyvern instead" — Crawl4AI is for the public web only.
- If a row fails 3 runs in a row, set `active = false` and surface to
  the user. Don't retry forever.

## Cron suggestion

```bash
hermes cron add --name crawl4ai-hourly  --schedule "5 * * * *"   --skill crawl4ai-fanout
hermes cron add --name crawl4ai-daily   --schedule "10 4 * * *"  --skill crawl4ai-fanout
hermes cron add --name crawl4ai-weekly  --schedule "20 4 * * 1"  --skill crawl4ai-fanout
```
