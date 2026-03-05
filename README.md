# AI Call Center CRM

Multi-tenant, bilingual (EN/ES) CRM backend and real-time dashboard for an AI cold call center with a 10M-lead database. Orchestrates AI voice agents (Vapi/Retell), extracts structured data via Google Gemini, and triggers cross-sell workflows.

## Tech Stack

- **Frontend:** Next.js 15, React 19, Tailwind CSS
- **Backend / DB:** Supabase (PostgreSQL, Auth, Edge Functions)
- **Automation:** n8n (webhooks)
- **AI Telephony:** Vapi / Retell AI
- **LLM:** Google Gemini (transcript extraction)

## Setup

### 1. Supabase

- Create a project at [supabase.com](https://supabase.com).
- Run migrations in order (see `supabase/migrations/`).
- In Dashboard → Settings → Edge Functions, add secret: `GEMINI_API_KEY`.

### 2. Migrations

From the project root (with Supabase CLI linked):

```bash
supabase db push
```

Or apply each migration via Dashboard SQL editor in numeric order.

### 3. Edge Function (Vapi webhook)

Deploy the ingestion function (JWT verification should be **disabled** for webhooks):

```bash
supabase functions deploy vapi-ingest --no-verify-jwt
```

Webhook URL: `https://<project-ref>.supabase.co/functions/v1/vapi-ingest`

Configure Vapi to `POST` call payloads (transcript + optional `recordingUrl`) to this URL. The body can include:

- `transcript` or `message.transcript`
- `recordingUrl` or `recording_url` or `call.recordingUrl`

Phone number is required for lead upsert; it is inferred from the transcript by Gemini or can be sent in the payload.

### 4. Next.js dashboard

```bash
cp .env.example .env.local
# Edit .env.local with NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY

npm install
npm run dev
```

## Business Logic

- **Re4lty Inc. (Anchor):** On status “Under Contract”, cross-sell rows are created for Dos Mortgage LLC, Laenan, Closed By Whom?, Wolf Insurance.
- **RENO LLC (Anchor):** Same status triggers cross-sell to Wolf Insurance.
- **Revenue:** Dos Mortgage = 2.75% of `estimated_loan_amount`; Laenan = $1,000; Closed By Whom? = $1,500; Wolf Insurance = $600.

## Database (RLS enabled)

- `companies` – Verticals and partners
- `leads` – Phone, name, language (EN/ES), location (default Naples, FL), status
- `calls` – Lead, company, transcript, recording_url, extracted_data (JSONB), calculated_revenue
- `cross_sells` – original_lead_id, target_company_id, status (Pending | Contacted | Closed)

## n8n

Use the same webhook URL in n8n if you want to proxy or enrich Vapi payloads before calling the Edge Function.
