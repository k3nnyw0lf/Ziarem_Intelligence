# Ziarem.com — AI Sales Floor & Enterprise CRM

Multi-tenant, bilingual (EN/ES) CRM backend and real-time command center for an AI cold call center. Hosted at **ziarem.com**. Orchestrates AI voice agents (Vapi/Retell), extracts structured data via Google Gemini, and executes cross-selling workflows with n8n (Hostinger).

## Tech Stack

- **Frontend:** Next.js 15 (App Router), React 19, Tailwind CSS, Shadcn UI (Lovable-compatible)
- **Backend / DB:** Supabase (PostgreSQL, Auth, Edge Functions, pgvector for RAG)
- **Automation:** n8n (self-hosted on Hostinger via webhooks)
- **AI Telephony:** Vapi / Retell AI (SIP, low-latency audio, barge-in, transcripts)
- **Voice:** ElevenLabs (multilingual v2)
- **LLM:** Google Gemini (extraction/JSON), Perplexity (live market context)

## Setup

### 1. Supabase

- Create a project at [supabase.com](https://supabase.com).
- Run migrations in order (see `supabase/migrations/`).
- In Dashboard → Settings → Edge Functions, add secret: `GEMINI_API_KEY`.
- Enable Realtime for table `calls` (Dashboard → Database → Replication) for the live call feed.

### 2. Migrations

```bash
supabase db push
```

Or run each migration in `supabase/migrations/` via SQL editor (numeric order).

### 3. Ingestion endpoints

**Option A — Next.js (ziarem.com):**

- Deploy Next.js and set env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, optional `N8N_WEBHOOK_ONBOARDING_URL`.
- Webhooks:  
  - `POST https://ziarem.com/api/webhooks/vapi-call-end` (Vapi call-end)  
  - `POST https://ziarem.com/api/webhooks/n8n-cross-sell` (n8n cross-sell status updates)  
  - Legacy: `POST …/api/webhooks/call-end` still supported.
- Body: `transcript` (required), `recordingUrl` or `recording_url` (optional), `phone_number` or `phone` (optional).

**Option B — Supabase Edge Function:**

```bash
supabase functions deploy vapi-ingest --no-verify-jwt
```

URL: `https://<project-ref>.supabase.co/functions/v1/vapi-ingest`

### 4. Dashboard (dark-mode command center)

```bash
cp .env.example .env.local
# Set NEXT_PUBLIC_SUPABASE_*, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY

npm install
npm run dev
```

- **Global overview:** Gross Pipeline Value (sum of `calculated_revenue` from calls).
- **Entity sidebar:** Filter CRM by company (Re4lty, Laenan, Wolf Insurance, etc.).
- **Live call feed:** Real-time table of AI calls with language, vertical, lead intent (Supabase Realtime on `calls`).

## Business Logic

- **Re4lty Inc. (Anchor):** When lead status = **Under Contract**, create `cross_sells` for Dos Mortgage, Laenan, Closed By Whom?, Wolf Insurance and trigger n8n bilingual onboarding webhook.
- **RENO LLC (Anchor):** Under Contract → cross-sell to Wolf Insurance.
- **Revenue:** Dos Mortgage = 2.75% of `estimated_loan_amount`; Laenan = $1,000; Closed By Whom? = $1,500; Wolf Insurance = $600.

## Database (RLS enabled)

- `companies` – id, name, vertical, is_partner, active_status
- `leads` – phone_number, first_name, last_name, preferred_language (EN/ES), location, estimated_value, **status** (Cold | Qualified | Under Contract | Closed)
- `calls` – lead_id, company_id, transcript, recording_url, extracted_data (JSONB), calculated_revenue
- `cross_sells` – original_lead_id, target_company_id, **status** (Pending | Automated_Outreach | Closed)

## n8n

Set `N8N_WEBHOOK_ONBOARDING_URL` to your n8n (Hostinger) webhook. The call-end pipeline POSTs a JSON payload (lead_id, preferred_language, vertical, cross_sell_triggered, etc.) for bilingual onboarding emails after cross-sell creation.
