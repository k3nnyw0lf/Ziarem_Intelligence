---
name: social-creator
description: Use this skill for the Ziarem creator AI suite — bilingual social-content generation across multiple brands (LinkedIn / IG / Twitter / TikTok). Trigger on "social posts", "social brands", "post schedule", "content jobs", "what's queued for X brand", "social engagement", "eclincher". Read-only view into social_brands / social_jobs / social_posts. Bilingual EN/ES.
---

# Social — multi-brand content engine

`social_brands` (6 brands) own:
- `social_agent_config` — LLM provider, HeyGen avatar, ElevenLabs voice
- `social_connections` — platform OAuth (LinkedIn / IG / Twitter / TikTok / FB)
- `social_jobs` — queued generation jobs (status: `pending → generating → ready → posted`)
- `social_posts` — actually-posted records with engagement
- `social_templates` — reusable per-brand templates

## Stage 1 — Brand health snapshot

```sql
SELECT b.name, b.industry, b.tone, b.is_active,
       (SELECT count(*) FROM social_connections WHERE brand_id = b.id AND is_connected) AS platforms_connected,
       (SELECT count(*) FROM social_jobs       WHERE brand_id = b.id
          AND status IN ('pending','generating')) AS queued,
       (SELECT count(*) FROM social_jobs       WHERE brand_id = b.id
          AND posted_at > now() - interval '7 days') AS posted_7d,
       (SELECT count(*) FROM social_posts      WHERE brand_id = b.id
          AND posted_at > now() - interval '30 days') AS posts_30d,
       (SELECT (engagement->>'likes')::int FROM social_posts WHERE brand_id = b.id
          ORDER BY posted_at DESC LIMIT 1) AS last_post_likes
FROM social_brands b
WHERE b.is_active
ORDER BY b.name;
```

## Stage 2 — Job queue (what's about to post)

```sql
SELECT j.id, j.brand_id, b.name AS brand,
       j.job_type, j.status, j.language,
       left(j.prompt, 80) AS prompt_preview,
       j.target_platforms,
       j.scheduled_for, j.posted_at,
       j.error_message
FROM social_jobs j
JOIN social_brands b ON b.id = j.brand_id
WHERE j.status IN ('pending','generating','ready','approved')
ORDER BY j.scheduled_for ASC NULLS LAST, j.created_at;
```

## Stage 3 — Engagement leaderboard (last 30d)

```sql
SELECT b.name AS brand, p.platform,
       count(*)                                                  AS posts,
       round(avg((p.engagement->>'likes')::int)::numeric, 1)     AS avg_likes,
       round(avg((p.engagement->>'comments')::int)::numeric, 1)  AS avg_comments,
       round(avg((p.engagement->>'shares')::int)::numeric, 1)    AS avg_shares,
       sum((p.engagement->>'impressions')::int)                  AS total_impressions
FROM social_posts p
JOIN social_brands b ON b.id = p.brand_id
WHERE p.posted_at > now() - interval '30 days'
GROUP BY b.name, p.platform
ORDER BY avg_likes DESC NULLS LAST;
```

## Stage 4 — Compliance keyword check

```sql
SELECT j.id, b.name AS brand, j.language,
       j.compliance_keywords, j.generated_content
FROM social_jobs j
JOIN social_brands       b ON b.id = j.brand_id
JOIN social_agent_config c ON c.brand_id = b.id
WHERE j.status = 'ready'
  AND c.auto_approve = false
  AND j.approved_by IS NULL
ORDER BY j.created_at;
```

These need human approval before posting. Insurance brands have hard
keyword filters (no "guarantee", no "best", no "free" without
disclaimer).

## Hard rules

- **Bilingual default.** `social_brands.language_split` (e.g. `{en:0.7,
  es:0.3}`) drives the generation language. Don't generate 100% EN for
  a 30% ES audience.
- **Platform-specific length limits enforced at generation time.**
  Twitter 280, LinkedIn 3000, IG caption 2200. Templates carry the
  per-platform variant.
- **API keys NEVER printed.** `social_api_keys.api_key` is server-side
  only; the agent never echoes it to chat output.
- **Insurance / financial brands have compliance review.**
  `auto_approve = false` is the default for those — never flip without
  ops sign-off.
- **eClincher** is the cross-platform poster (when
  `eclincher_profile_id` is set on the connection). Direct platform
  posts are fallback only.
