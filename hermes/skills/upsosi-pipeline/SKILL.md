---
name: upsosi-pipeline
description: Use this skill for UPSOSI content automation — the bilingual (EN/ES) podcast + social-video factory that runs nightly. Trigger on "upsosi", "podcast pipeline", "what content is queued", "approve videos", "ziarem_video_jobs", "brand voices", "Reno Report", "Naples Real Estate", "Dos Mortgage Show", "Upsosi Spotlight", "kling check", "higgsfield". Read-only by default; approval is operator-driven.
---

# UPSOSI — bilingual content automation pipeline

UPSOSI is the content factory layered on top of the Ziarem creator suite.
12 pg_cron jobs orchestrate 9 Edge Functions to produce daily bilingual
podcasts + social videos across 5+ brands.

## The data layer (under `ziarem_*` prefix, not `upsosi_*`)

```
ziarem_brands           — 7 brand profiles (voice, persona, hashtags)
ziarem_avatars          — HeyGen / talking-photo registry
ziarem_topic_queue      — 20 topic candidates ready to script
ziarem_video_jobs       — 55 jobs (script_en + script_es + video URLs)
social_brands           — 6 platform-connected brand identities
social_agent_config     — per-brand HeyGen avatar + ElevenLabs voice ID
social_posts            — 15 posts published to platforms
ziarem_onlysocial_posts — cross-platform poster ledger
```

## The cron orchestrator (12 daily jobs)

| Job | Schedule | Edge Function | Purpose |
|---|---|---|---|
| `upsosi-news-scan`         | 7,13,19,1 UTC | `news-scanner`         | Pull trending topics from RSS / news APIs |
| `upsosi-content-daily`     | 13:00 UTC     | `content-orchestrator?mode=full` | Generate daily content (script + render) |
| `upsosi-check-rendering`   | every 30m     | `content-orchestrator?mode=check_rendering` | Poll HeyGen/Higgsfield for completion |
| `upsosi-post-ready`        | every :15     | `content-orchestrator?mode=post_ready` | Push completed videos to platforms |
| `upsosi-kling-check`       | every 15m     | `kling-generator?action=check_all` | Kling video status polling |
| `upsosi-podcast-weekly`    | Fri 14:00     | `podcast-generator?action=generate_all_shows` | Weekly podcast batch for all brands |
| `upsosi-hashtag-optimize`  | 1st & 15th    | `hashtag-optimizer`    | Per-platform hashtag refresh |
| `upsosi-competitor-scan`   | Wed/Sat 14:00 | `competitor-monitor`   | Scrape competitor brands' posts |
| `upsosi-analytics`         | 6:00 + 18:00  | `analytics-collector`  | Pull engagement metrics back |
| `upsosi-ai-learner`        | Sun 7:00      | `content-learner`      | Weekly pattern learning from analytics |
| `upsosi-billing-daily`     | 12:00         | `payment-handler`      | Stripe billing for white-label users |
| `upsosi-weekly-reports`    | Mon 13:00     | `upsosi-email`         | Email weekly summary to brand owners |

## Stage 1 — Pipeline state (the morning check)

```sql
SELECT
  status,
  count(*) AS jobs,
  count(*) FILTER (WHERE heygen_video_id IS NOT NULL)    AS rendering_heygen,
  count(*) FILTER (WHERE higgsfield_job_id IS NOT NULL)  AS rendering_higgsfield,
  count(*) FILTER (WHERE video_url_en IS NOT NULL OR video_url_es IS NOT NULL) AS rendered,
  min(created_at)                                        AS oldest,
  max(created_at)                                        AS newest
FROM ziarem_video_jobs
GROUP BY status
ORDER BY count(*) DESC;
```

## Stage 2 — Pending-approval queue (operator action needed)

```sql
SELECT vj.id, vj.title, vj.topic, vj.content_type, vj.language,
       b.name AS brand,
       length(vj.script_en) AS en_chars,
       length(vj.script_es) AS es_chars,
       vj.created_at,
       (now()::date - vj.created_at::date) AS age_days
FROM ziarem_video_jobs vj
LEFT JOIN ziarem_brands b ON b.id = vj.brand_id
WHERE vj.status = 'pending_approval'
ORDER BY vj.created_at DESC
LIMIT 50;
```

For each row, the operator decides: approve (→ render) or reject (→
discard). Approval flips status from `pending_approval` to `approved`,
and `upsosi-content-daily` picks it up on next run.

## Stage 3 — Bulk approve all jobs from a specific brand

```sql
-- Approve every pending job for "Naples Insurance Talk"
UPDATE public.ziarem_video_jobs
   SET status = 'approved'
 WHERE status = 'pending_approval'
   AND title ILIKE '%Naples Insurance Talk%';
```

Or to approve everything older than 7 days (assume good if you didn't
say no in a week):

```sql
UPDATE public.ziarem_video_jobs
   SET status = 'approved'
 WHERE status = 'pending_approval'
   AND created_at < now() - interval '7 days';
```

## Stage 4 — Brand → avatar/voice binding

```sql
SELECT
  sb.name AS brand,
  sb.is_active,
  sac.heygen_avatar_id,
  sac.heygen_voice_id,
  sac.elevenlabs_voice_id,
  sac.elevenlabs_voice_name,
  sac.auto_approve,
  sac.max_daily_posts
FROM social_brands sb
LEFT JOIN social_agent_config sac ON sac.brand_id = sb.id
ORDER BY sb.is_active DESC, sb.name;
```

If `heygen_avatar_id IS NULL` — that brand's videos can't render.
Either bind the user's personal Ken Wolf avatar (default) or pick a
brand-specific HeyGen avatar.

## Stage 5 — Render queue (currently in flight at HeyGen / Higgsfield / Kling)

```sql
SELECT vj.id, vj.title,
       vj.heygen_video_id, vj.higgsfield_job_id,
       vj.status, vj.error_message,
       (now() - vj.ai_generated_at) AS time_since_render_kicked
FROM ziarem_video_jobs vj
WHERE vj.status IN ('rendering','generating','queued')
   OR (vj.heygen_video_id IS NOT NULL AND vj.video_url_en IS NULL)
   OR (vj.higgsfield_job_id IS NOT NULL AND vj.higgsfield_url_en IS NULL)
ORDER BY vj.created_at DESC
LIMIT 30;
```

If a job's been stuck in render for >2 hours: the upstream provider
(HeyGen / Higgsfield / Kling) likely failed silently. Check
`error_message` — `upsosi-check-rendering` cron writes failures
there.

## Stage 6 — Published posts (engagement tracking)

```sql
SELECT
  sp.platform,
  count(*)                                                AS posts,
  round(avg((sp.engagement->>'likes')::int)::numeric, 1)  AS avg_likes,
  round(avg((sp.engagement->>'views')::int)::numeric, 1)  AS avg_views,
  max(sp.posted_at)                                       AS latest_post
FROM social_posts sp
WHERE sp.posted_at > now() - interval '30 days'
GROUP BY sp.platform
ORDER BY avg_views DESC NULLS LAST;
```

## Stage 7 — Topic queue (what's next)

```sql
SELECT id, topic, brand_id, content_type, priority, scheduled_for, status
FROM ziarem_topic_queue
WHERE status NOT IN ('used','expired','rejected')
ORDER BY scheduled_for ASC NULLS LAST, priority DESC NULLS LAST
LIMIT 30;
```

## Hard rules

- **Never bulk-approve untouched jobs older than 30 days** — topics go
  stale (Citizens Insurance change of policy, hurricane forecast,
  rate cuts). Approve recent or reject.
- **Bilingual default.** The pipeline writes both `script_en` AND
  `script_es`. Don't render only one unless the brand's
  `language_split` says so.
- **Compliance keywords.** Insurance brands have hard stops on words
  like "guarantee", "best", "free" — `social_agent_config.compliance_keywords`
  is the list. The orchestrator checks before render; if a script
  contains a forbidden keyword the job sits at `pending_revision`.
- **Render cost matters.** HeyGen credits are limited (600 right now).
  An approve-all on 55 pending podcasts = 55 × ~30s clips = ~28 min
  of credits — well within budget but worth knowing.
- **Higgsfield + Kling are alt video providers.** UPSOSI orchestrator
  picks per content_type: educational/short → HeyGen, cinematic →
  Higgsfield, pure text-to-video → Kling. All three are wired.
- **OnlySocial is the cross-platform fan-out** — one render produces
  TikTok / IG / YT Shorts / FB posts simultaneously via
  `ziarem_onlysocial_posts`.

## Cross-business links

- `ziarem_video_jobs.brand_id` → `ziarem_brands.id` (UPSOSI brands)
- `social_brands.id` → `social_agent_config.brand_id` (platform OAuth)
- `Naples Insurance Talk` brand → drives Wolf Surety leads via
  `naples_insurance_talk` UTM in the embedded landing page
- `Dos Mortgage Show` → drives DM lead intake the same way

## What the operator should do TODAY

1. Use Stage 2 query to review the 55 pending podcasts.
2. **Bulk-approve the 5 most-recent per brand** (so you have ~7-10
   days of fresh content rendering).
3. Once Ken's HeyGen avatar + ElevenLabs voice are cloned, run the
   bind in Stage 4 against all active brands.
4. Wait 2-4 hours for HeyGen to render the first batch.
5. Spot-check 1-2 finished videos before flipping `auto_approve = true`
   on a brand you trust.
