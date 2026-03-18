# Ziarem — Complete Setup Guide

This repo contains **two runnable surfaces** that can be used together or separately:

1. **Next.js app (CRM dashboard + API routes)** — Supabase, Vapi webhooks, score-leads, WhisperCard, etc.
2. **Node.js API (Ziarem Intelligence)** — Hostinger PostgreSQL, leads pagination, upload, enrichment, Cole/FA+CP import.

---

## Quick start (Next.js only)

Use this when you only need the **dashboard and webhooks** (Supabase + Vapi + n8n).

```bash
cp .env.example .env.local
# Set at least: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY

npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Root redirects to `/realty`.

---

## Quick start (Node API only)

Use this when you only need the **leads API** (Hostinger PostgreSQL, import, enrichment).

```bash
cp .env.example .env
# Set: PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGSSLMODE=require

npm install
PORT=3001 npm run api:start
# or: npm run api:dev  (uses PORT from env or 3000)
```

- Health: [http://localhost:3001/health](http://localhost:3001/health)
- Leads: [http://localhost:3001/leads](http://localhost:3001/leads)

---

## Run both (Next.js + Node API)

1. **Next.js** on port **3000** (default):

   ```bash
   npm run dev
   ```

2. **Node API** on port **3001** (separate terminal):

   ```bash
   PORT=3001 npm run api:start
   ```

Use `.env` for Node (PG* vars) and `.env.local` for Next.js (Supabase + optional PG* if you ever point Next at Hostinger). Do not set `PORT` in `.env` to 3000 if you run both, or set Node to 3001 only when running both.

---

## Environment variables (reference)

| Variable | Used by | Purpose |
|----------|--------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Next.js | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Next.js | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Next.js API routes | Webhooks, score-leads, admin |
| `GEMINI_API_KEY` | Next.js (extract, objection-rebuttal) | Transcript extraction, RAG, SMS reply |
| `N8N_WEBHOOK_ONBOARDING_URL` | Next.js (call-end) | n8n onboarding after cross-sell |
| `CRON_SECRET` | Next.js (score-leads) | Optional auth for cron |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | Next.js (generate-contract, inbound-sms) | SMS for signing link and replies |
| `DOCUSIGN_API_URL`, `DOCUSIGN_API_KEY` (or PANDADOC_*) | Next.js (generate-contract) | Contract/signing URL |
| `TCPA_FIREWALL_URL`, `TCPA_FIREWALL_API_KEY` | Next.js (scrubDNC) | TCPA pre-scrub before outbound |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE` | Node API | Hostinger PostgreSQL |
| `PORT` | Node API | Default 3000; use 3001 when running with Next.js |
| `ABSTRACT_EMAIL_API_KEY`, `ABSTRACT_PHONE_API_KEY`, `NUMVERIFY_API_KEY` | Node API (enrichment) | Optional lead enrichment |
| `TRACKING_BASE_URL` | Node API (omni-send) | Open-tracking pixel base URL |

---

## Database (two systems)

- **Supabase** — Used by the Next.js app: companies, leads (CRM), calls, cross_sells, sales_frameworks, cultural_matrices, sales_objections, interactions, compliance_blocks, storage. Run migrations in `supabase/migrations/` (numeric order).
- **Hostinger PostgreSQL** — Used by the Node API: `leads` (Cole/FA+CP schema), `raw_leads`, dictionary tables, communications. Run schemas in `database/schema/` (see README or COLE_CRM_ALIGNMENT.md).

---

## Deploy (Hostinger / production)

- **Next.js:** Build with `npm run build`, then `npm run start` (or use the standalone output and run `node .next/standalone/server.js`). Set env in the host (e.g. Hostinger Node app or PM2).
- **Node API:** Run `npm run api:start` with `PORT` and PG* set. Can run on the same VPS as Next.js on a different port and put both behind a reverse proxy (e.g. Next.js on :3000, Node on :3001; proxy ziarem.com → 3000, api.ziarem.com → 3001).
