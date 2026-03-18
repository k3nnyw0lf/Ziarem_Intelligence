# Free APIs – Activation Guide

Use these free tiers for the AI Call Center CRM. Activate in this order.

---

## 1. Supabase (Database, Auth, Edge Functions)

- **URL:** https://supabase.com  
- **Free tier:** 500MB DB, 50K monthly active users, 2M Edge Function invocations/month, 5GB storage.

**Activate:**
1. Sign up at https://supabase.com → New project.
2. Copy **Project URL** and **anon public** key from Settings → API.
3. In Dashboard → Settings → Edge Functions, add secret: `GEMINI_API_KEY` (from step 3 below).
4. Run migrations in `supabase/migrations/` via SQL Editor or `supabase db push`.

**Env:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## 2. Google Gemini (Transcript extraction)

- **URL:** https://aistudio.google.com/apikey or https://makersuite.google.com/app/apikey  
- **Free tier:** Gemini 1.5 Flash: 15 RPM, 1M TPM, 1,500 requests/day.

**Activate:**
1. Go to https://aistudio.google.com/apikey (Google AI Studio).
2. Create API key (use same Google account as Cloud if you link later).
3. Copy the key and set it in Supabase: Project → Settings → Edge Functions → Secrets → `GEMINI_API_KEY`.

**Used in:** Edge Function `vapi-ingest` for structured extraction from call transcripts.

---

## 3. Vapi (AI telephony – optional)

- **URL:** https://vapi.ai  
- **Free tier:** Trial minutes for voice AI; webhooks included.

**Activate:**
1. Sign up at https://vapi.ai.
2. Create an assistant and configure the webhook URL:  
   `https://<your-supabase-ref>.supabase.co/functions/v1/vapi-ingest`
3. Send in POST body: `transcript`, optional `recordingUrl`, optional `phone_number` / `phone`.

**Alternative:** Retell AI, or any provider that can POST transcript + optional recording URL to the same webhook.

---

## 4. n8n (Workflow automation – optional, self‑hosted)

- **URL:** https://n8n.io  
- **Free:** Self-hosted is free; n8n Cloud has a free tier.

**Activate (self-hosted):**
- Docker: `docker run -it --rm -p 5678:5678 n8nio/n8n`
- Or install via npm: `npm install n8n -g && n8n start`

Use webhook nodes to call your Supabase Edge Function or to orchestrate follow-up (e.g. cross-sell triggers).

---

## 5. Vercel (Next.js hosting – optional)

- **URL:** https://vercel.com  
- **Free tier:** Hobby plan for personal projects, serverless functions.

**Activate:**
1. Import repo from GitHub (after you push).
2. Add env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Deploy; dashboard will be live at `*.vercel.app`.

---

## 6. Resend (Transactional email – optional)

- **URL:** https://resend.com  
- **Free tier:** 3,000 emails/month, 100/day.

**Activate:** Sign up → API Keys → create key. Use for lead follow-up or notifications if you add an email flow later.

---

## Summary

| Service    | Purpose              | Required | Env / config                          |
|-----------|----------------------|----------|---------------------------------------|
| Supabase  | DB, Auth, Edge Fns   | Yes      | `NEXT_PUBLIC_SUPABASE_*`, Edge secrets |
| Gemini    | Transcript extraction| Yes      | `GEMINI_API_KEY` (Edge Function)      |
| Vapi      | Voice / webhook      | Optional | Webhook URL in Vapi dashboard         |
| n8n       | Automation           | Optional | Self-host or n8n Cloud                 |
| Vercel    | Hosting dashboard    | Optional | Vercel project env                     |
| Resend    | Email                | Optional | `RESEND_API_KEY` if you add email     |

After activating Supabase and Gemini and deploying the Edge Function, the pipeline (Vapi → webhook → Gemini → DB + cross-sells) works end-to-end.
