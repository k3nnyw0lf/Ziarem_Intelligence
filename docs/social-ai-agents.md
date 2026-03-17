# Social AI Agents Module

Internal documentation for the Ziarem/VAULT Social AI Agent system.

---

## 1. Overview

The Social AI Agents module is a "Ken Clone" system that generates bilingual social media content across 6 brands. It combines:

- **Claude AI** (Anthropic) for content generation (scripts, captions, hashtags)
- **ElevenLabs** for voice synthesis on video content
- **HeyGen** for AI avatar video rendering
- **eClincher** for multi-platform social media scheduling and analytics

Content is generated in both English and Spanish (default 70/30 split), targeting the Miami market with Colombian Spanish style. Each brand has its own AI agent that can be independently enabled, configured, and rate-limited.

The UI lives in `src/SocialAgents.jsx` and is mounted at the `social` view in `src/App.jsx`.

---

## 2. Architecture

```
+---------------------+
|     Ziarem UI       |
| (SocialAgents.jsx)  |
+----------+----------+
           |
     +-----+------+------------------------------+
     |            |                               |
     v            v                               v
+---------+  +----------------------------+  +-----------+
| Supabase|  | n8n Webhook                |  | Supabase  |
| (Read/  |  | POST /social-generate      |  | (Write    |
|  Write) |  | POST /social-schedule      |  |  callback)|
+---------+  +----------------------------+  +-----------+
  |               |                               ^
  |               v                               |
  |  +---------------------------+                |
  |  |        n8n Workflows      |                |
  |  |                           |                |
  |  |  1. Fetch brand details   |                |
  |  |       (Supabase)          |                |
  |  |  2. Claude API            |                |
  |  |       (content gen)       |                |
  |  |  3. ElevenLabs API        |                |
  |  |       (voice synthesis)   |                |
  |  |  4. HeyGen API            |                |
  |  |       (video rendering)   |                |
  |  |  5. eClincher API         |                |
  |  |       (schedule post)     |                |
  |  |  6. Save job to Supabase -+----------------+
  |  |  7. Telegram notification |
  |  +---------------------------+
  |
  v
+-----------------------------------+
| vault_social_brands               |
| vault_social_connections          |
| vault_social_agent_config         |
| vault_social_api_keys             |
| vault_social_posts                |
| vault_social_generation_logs      |
+-----------------------------------+
```

**Data flow summary:**

1. User clicks "Generate Today's Content" in Ziarem UI
2. Ziarem calls `n8nPost("social-generate", payload)` which POSTs to the n8n webhook
3. n8n fetches brand details from Supabase, calls Claude to generate content
4. For video content: n8n calls ElevenLabs for audio, then HeyGen for video rendering
5. n8n saves the generated job back to Supabase and returns the result
6. For scheduling: Ziarem calls `n8nPost("social-schedule", payload)` which sends to eClincher
7. A cron workflow (`social-post-analytics`) polls eClincher every 6 hours for engagement metrics

---

## 3. Setup Guide

### API Keys Needed

| Service | Key format | Where to get it |
|---------|-----------|-----------------|
| Anthropic (Claude) | `sk-ant-...` | [console.anthropic.com](https://console.anthropic.com/) |
| ElevenLabs | `xi-...` | [elevenlabs.io/app/settings](https://elevenlabs.io/app/settings) |
| HeyGen | `hg-...` | [app.heygen.com/settings](https://app.heygen.com/settings) |
| eClincher | `ec-...` | eClincher dashboard > API Settings |
| GHL (GoHighLevel) | `ghl-...` | GHL Settings > API Keys |
| n8n webhook secret | any string | You define this; must match n8n's expected header |

### Configure in Ziarem Settings Tab

1. Open Ziarem and navigate to **Social AI Agents** (the `social` view)
2. Click the **Settings** tab
3. Enter each API key in the corresponding field
4. Set the **n8n Webhook URL** to your n8n instance base URL (e.g., `https://n8n.srv1257040.hstgr.cloud/webhook`)
5. Set the **n8n Webhook Secret** for HMAC verification
6. Click **Save Keys**
7. Use the **Test** button next to each field to verify connectivity

Keys are stored in `vault_social_api_keys` with RLS scoped to the authenticated user only.

### n8n Webhook URL Setup

The n8n base URL is defined in `src/App.jsx`:

```
const N8N_BASE = "https://n8n.srv1257040.hstgr.cloud/webhook";
```

Three n8n workflows handle social operations:

| Workflow | Webhook path | Trigger |
|----------|-------------|---------|
| Content Generation | `POST /social-generate` | User clicks "Generate" |
| Schedule Post | `POST /social-schedule` | User approves + schedules |
| Post Analytics | Cron (every 6h) | Automatic |

Import the workflow JSON files from `n8n-workflows/social-content-generate.json`, `social-schedule-post.json`, and `social-post-analytics.json`.

### SQL Migration

Run the migration against your Supabase project:

```bash
supabase db push
# or apply directly:
psql $DATABASE_URL < supabase/migrations/social_ai_agents.sql
```

This creates all 6 `vault_social_*` tables, RLS policies, indexes, triggers, and seeds the default brand rows.

---

## 4. Brands Configuration

### Default Brands

| Brand | Slug | Business Type | Color |
|-------|------|---------------|-------|
| Wolf Surety | `wolf-surety` | Surety Bonds (`INSURANCE`) | `#f59e0b` |
| Re4lty | `re4lty` | Real Estate (`REAL_ESTATE`) | `#6366f1` |
| Closed By Whom | `closed-by-whom` | Real Estate Tech (`TITLE`) | `#10b981` |
| Dispute LLC | `dispute-llc` | Credit Repair (`CREDIT`) | `#ef4444` |
| Mansion Signature | `mansion-signature` | Luxury RE (`REAL_ESTATE`) | `#a855f7` |
| Tax | `tax` | Tax Services (`TAX`) | `#3b82f6` |

### Enable/Disable Agents

Each brand has an independent toggle on the Brands & Agents tab. When disabled:
- The "Generate Today's Content" button is grayed out
- No n8n webhooks are fired for that brand
- Existing queued content is unaffected

Toggle state is persisted in `vault_social_agent_config.enabled`.

### Daily Limits

Each brand has two configurable caps:
- **daily_video_limit** (default: 3) -- max video posts per calendar day
- **daily_post_limit** (default: 5 in config UI, 10 in DB default) -- max text/image posts per day

The UI checks these limits before firing the generation webhook. If the cap is reached, a toast error appears and the request is blocked client-side.

### Language Mix

Default: **70% English / 30% Spanish**

Stored as `default_language_mix` JSONB on `vault_social_brands`: `{"en": 0.7, "es": 0.3}`

Per-brand override is configured via the brand settings modal slider. The split is sent to n8n in the generation payload as `languageMix`.

---

## 5. Content Generation Flow

### Step-by-step

1. **User clicks "Generate Today's Content"** on a brand card
2. Client checks daily limits (videos and posts) against today's existing posts
3. Client builds payload and calls `n8nPost("social-generate", payload)`
4. n8n receives the webhook at `POST /social-generate`
5. n8n fetches brand details from Supabase
6. n8n sends prompt to **Claude API** (`claude-sonnet-4-20250514`, max 2048 tokens)
7. Claude returns JSON with `text`, `hashtags`, and `captions` per platform
8. n8n parses the response (handles both raw JSON and markdown code blocks)
9. n8n saves the job to Supabase with status `generated`
10. n8n returns the result to Ziarem
11. Ziarem creates `vault_social_posts` rows with status `DRAFT`
12. Posts appear in the Content Queue tab for review

### Payload Structure (Ziarem to n8n)

```json
{
  "brandId": "wolf-surety",
  "brandName": "Wolf Surety",
  "languageMix": { "en": 70, "es": 30 },
  "critiquePercent": 0,
  "dailyCaps": { "videos": 3, "posts": 5 },
  "guardrails": {
    "disallowLegalAdvice": true,
    "disallowDefamation": true,
    "requireDisclaimer": true,
    "neverNameCompetitors": true
  },
  "platforms": ["instagram", "tiktok"],
  "userId": "<supabase-auth-uid>"
}
```

### Status Transitions

```
DRAFT --> READY_TO_RENDER --> RENDERING --> READY_TO_POST --> SCHEDULED --> POSTED
  |                                           |
  +---> FAILED <------------------------------+
```

- **DRAFT**: Content generated, awaiting human review
- **READY_TO_RENDER**: Approved for video rendering (ElevenLabs + HeyGen)
- **RENDERING**: Video is being processed
- **READY_TO_POST**: Content is finalized, ready for scheduling
- **SCHEDULED**: Sent to eClincher with a scheduled time
- **POSTED**: Published and confirmed
- **FAILED**: Error at any stage

### User Actions in Content Queue

- **Approve** (DRAFT/READY_TO_RENDER -> READY_TO_POST)
- **Reject** (DRAFT/READY_TO_RENDER -> FAILED)
- **Schedule** (READY_TO_POST -> SCHEDULED)
- **Delete** (any status)

---

## 6. Database Tables

All tables use `vault_social_` prefix and have RLS enabled.

### vault_social_brands

Brand definitions. Each brand has an `owner_id` linked to `auth.users`. Contains name, slug, business type, logo URL, default language mix, daily limits, timezone, and active flag.

### vault_social_connections

Maps brands to social platform accounts. Stores the `eclincher_profile_id` for posting. Constrained to: INSTAGRAM, TIKTOK, YOUTUBE, LINKEDIN, FACEBOOK, X.

### vault_social_agent_config

Per-brand agent settings: enabled flag, posting hours window (start/end), daily video/post caps, auto-approval toggle, bilingual mode flag, and critique percent (0-100).

### vault_social_api_keys

Per-user API key storage. One row per user. Stores keys for Anthropic, ElevenLabs, HeyGen, eClincher, n8n webhook URL/secret, and GHL. RLS restricted to owner only.

### vault_social_posts

Individual content items. Each post has: brand reference, job ID, platform, language (EN/ES), content type (VIDEO_SHORT/IMAGE/CAROUSEL/TEXT), hook, script, caption, hashtags, status, scheduling timestamps, media URLs (HeyGen video, ElevenLabs audio), eClincher post ID, metrics JSONB, and approval tracking.

### vault_social_generation_logs

Audit trail for generation events. Event types: GENERATION_STARTED, CONTENT_GENERATED, VIDEO_READY, POST_PUBLISHED, METRICS_UPDATED, ERROR. Each log entry includes a JSONB payload with details.

---

## 7. n8n Workflow Integration

### Workflows

There are three n8n workflow files in `n8n-workflows/`:

**social-content-generate.json** -- Content generation pipeline:
```
Webhook Trigger -> Fetch Brand Details -> Claude Generate Content -> Map Response -> Save Job to Supabase -> Format Webhook Response
```

**social-schedule-post.json** -- Post scheduling pipeline:
```
Webhook Trigger -> Fetch Job from Supabase -> Prepare Post Data -> Schedule via eClincher -> Update Job Status -> Notify Ken via Telegram -> Format Webhook Response
```

**social-post-analytics.json** -- Analytics collection (cron, every 6 hours):
```
Every 6 Hours -> Fetch Active Posts -> Split Into Items -> Fetch eClincher Analytics -> Map Engagement Data -> Update Engagement in Supabase
```

### Expected Webhook Endpoints

| Path | Method | Purpose |
|------|--------|---------|
| `/social-generate` | POST | Trigger content generation |
| `/social-schedule` | POST | Schedule a post via eClincher |
| `/social-test-connection` | POST | Test API key connectivity |

### HMAC Signature Verification

The `n8n_webhook_secret` from `vault_social_api_keys` is intended for HMAC-SHA256 verification of webhook callbacks. When n8n posts status updates back to Ziarem, include:

```
x-webhook-signature: HMAC-SHA256(body, secret)
```

### Callback Event Types

Events logged to `vault_social_generation_logs`:

| Event | Meaning |
|-------|---------|
| `GENERATION_STARTED` | n8n received the webhook and began processing |
| `CONTENT_GENERATED` | Claude returned content successfully |
| `VIDEO_READY` | HeyGen finished rendering the video |
| `POST_PUBLISHED` | eClincher confirmed publication |
| `METRICS_UPDATED` | Analytics cron updated engagement data |
| `ERROR` | Any failure in the pipeline |

### Error Handling

- Claude response parsing handles both raw JSON and markdown-fenced JSON blocks
- The analytics workflow batches eClincher API calls (5 at a time, 1s interval) to avoid rate limits
- The schedule workflow sends a Telegram notification to Ken (chat ID `284251009`) on every scheduled post
- Failed posts are logged with `error_message` on the post row

---

## 8. Bilingual Mode

### How the 70/30 EN/ES Split Works

The `languageMix` is sent in the generation payload. When n8n triggers Claude, the language parameter determines which language the content is written in. Out of a batch of posts:

- ~70% are generated in English (`language: "en"`)
- ~30% are generated in Spanish (`language: "es"`)

Each post row stores its language as `EN` or `ES` in `vault_social_posts.language`.

### Colombian Spanish Style for Miami Market

The Spanish content targets the South Florida / Miami market using Colombian Spanish conventions:
- Uses "usted" over "tu" for formal tone where appropriate
- Avoids Spain-specific slang
- Natural conversational tone familiar to the Colombian and broader Latin American diaspora in Miami

### Per-Brand Override

Each brand can override the default 70/30 split via the brand settings modal:
- A slider control adjusts from 0% to 100% Spanish
- The English percentage auto-calculates as the complement
- Changes persist to `vault_social_agent_config` and take effect on the next generation

---

## 9. Compliance and Guardrails

Four guardrails are enforced on every generation request:

```javascript
const GUARDRAILS = {
  disallowLegalAdvice: true,
  disallowDefamation: true,
  requireDisclaimer: true,
  neverNameCompetitors: true,
};
```

| Guardrail | Description |
|-----------|-------------|
| `disallowLegalAdvice` | AI must not generate content that could be construed as legal advice. Particularly critical for Wolf Surety (surety bonds) and Closed By Whom (title). |
| `disallowDefamation` | No content that disparages individuals, companies, or competitors. |
| `requireDisclaimer` | Generated content must include appropriate disclaimers where applicable (e.g., "not financial advice"). |
| `neverNameCompetitors` | Content must never reference competitors by name. Generic comparisons are acceptable. |

### Critique Mode

Critique mode is a per-brand toggle that allocates a percentage of generated content (default 15%, configurable 0-40%) to "critique-style" posts. These are opinion or comparison pieces.

Restrictions when critique mode is active:
- The `neverNameCompetitors` guardrail still applies
- Critique content must remain factual and non-defamatory
- The critique percentage is sent as `critiquePercent` in the payload (set to 0 when critique mode is disabled)

---

## 10. Troubleshooting

### "Generate Today's Content" button is disabled

- Check that the brand's agent is toggled **ON** in the Brands & Agents tab.
- Verify the agent config exists in `vault_social_agent_config` for that brand.

### "Daily video/post limit reached" toast

- The client checks today's posts by `created_at` date prefix. Limits reset at midnight UTC.
- Adjust limits in the brand settings modal or directly in `vault_social_agent_config`.

### Generation fires but no posts appear

- Check n8n execution logs for the `social-content-generate` workflow.
- Verify the Anthropic API key is valid and has credits.
- Look for errors in the browser console; `n8nPost` failures are logged there.
- Confirm the n8n webhook URL is correct in Settings.

### Posts stuck in RENDERING status

- HeyGen video rendering can take 2-10 minutes. If stuck longer, check HeyGen dashboard for the job status.
- The n8n callback may have failed. Check `vault_social_generation_logs` for `ERROR` events with that job ID.

### eClincher scheduling fails

- Verify the eClincher API key in Settings.
- Ensure the brand has at least one active `vault_social_connections` row with a valid `eclincher_profile_id`.
- Check that the scheduled time is in the future and within the brand's posting hours window.

### API key test shows failure

- The test button calls `n8nPost("social-test-connection", { service, userId })`. This requires the corresponding n8n workflow to be active.
- Check that the n8n instance is reachable from the browser.

### No engagement metrics updating

- The analytics workflow runs on a 6-hour cron. Check that it is active in n8n.
- Only posts with `eclincher_post_id` set are fetched for analytics.
- The workflow batches requests (5 at a time) to respect eClincher rate limits.

### RLS / permission errors

- All tables use Row-Level Security. Brands are readable by any authenticated user but writable only by the owner.
- API keys are fully restricted to the owner (select, insert, update, delete).
- Ensure the Supabase anon key is being passed correctly in n8n workflow HTTP headers.
