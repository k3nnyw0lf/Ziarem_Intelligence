---
name: oss-radar
description: Use this skill for OSS Radar — scouts open-source tools weekly, ranks by stars/heat, tags hot rising tools. Trigger on "OSS radar", "what's hot in OSS", "new tools this week", "trending repos", "should we add X to the stack". Read-only view of oss_radar_tools / oss_stack / oss_radar_scan_log.
---

# OSS Radar — open-source tool scout

```
oss_radar_scan_log     — weekly scan runs (status / counts / scanned_at)
oss_radar_tools        — raw discoveries (stars, hot, week, is_new)
oss_stack              — curated additions, tagged by target_app + use_case
oss_stack_searches     — operator search history (what was looked up)
```

## Stage 1 — Last scan

```sql
SELECT scanned_at, status, tools_found, tools_added, notes
FROM oss_radar_scan_log
ORDER BY scanned_at DESC
LIMIT 5;
```

## Stage 2 — Hot rising tools (this week's heat)

```sql
SELECT name, category, stars, week, is_new, hot, github,
       left(description, 120) AS description_preview
FROM oss_radar_tools
WHERE hot = true
   OR (week = (SELECT max(week) FROM oss_radar_tools) AND is_new = true)
ORDER BY stars DESC NULLS LAST
LIMIT 30;
```

## Stage 3 — Stack additions (what we've adopted)

```sql
SELECT s.name, s.category, s.target_app, s.use_case, s.status,
       s.stars, s.hot, s.added_by, s.created_at
FROM oss_stack s
WHERE s.status NOT IN ('rejected','retired','duplicate')
ORDER BY s.created_at DESC
LIMIT 50;
```

## Stage 4 — Coverage gaps (categories with no stack entries)

```sql
SELECT t.category,
       count(*)                                  AS discovered_tools,
       count(s.id)                               AS adopted_into_stack,
       round(100.0 * count(s.id) / count(*), 1)  AS adoption_pct
FROM oss_radar_tools t
LEFT JOIN oss_stack s ON s.github = t.github
GROUP BY t.category
HAVING count(*) >= 3
ORDER BY adoption_pct ASC;
```

Categories with low adoption_pct are blind spots — operator should
review.

## Stage 5 — Search history (what teammates looked up but maybe didn't add)

```sql
SELECT query, jsonb_array_length(coalesce(results,'[]'::jsonb)) AS hits, searched_at
FROM oss_stack_searches
WHERE searched_at > now() - interval '30 days'
ORDER BY searched_at DESC
LIMIT 30;
```

## Hard rules

- **`stars` is a proxy, not a verdict.** A 50k-star tool with no commits
  in 18 months is dead. Cross-check `github` URL + commit recency
  before adopting.
- **License check before adoption.** Anything that touches client data
  (Mem0, Skyvern, etc.) must be permissive (MIT / Apache-2 / BSD).
  Copyleft (GPL-3) is operator-decision per use case.
- **`oss_stack.target_app` matches `apps.yaml` slugs.** When adopting,
  always tag the destination app — so we know what's powering what.
- **No automated installs.** OSS Radar discovers; operators decide.
  This skill never INSERTs into `oss_stack` — that's a deliberate UI
  step.
