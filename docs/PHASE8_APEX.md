# Phase 8: Ziarem Apex Architecture

## 1. Multi-Agent Swarm (WebSocket Whisper Engine)

- **Run:** `npm run swarm` (or `npx tsx src/swarm/ws-server.ts`). Listens on `SWARM_WS_PORT` (default 3100).
- **Discovery:** `GET /api/ws/swarm` returns the WebSocket URL and protocol.
- **Protocol:** Clients send JSON: `{ type: "transcript", call_id: "<vapi-call-id>", text: "<chunk>", previousContext?: string }`. The server runs **quant_agent** (Dos Mortgage/Laenan fee math) and **underwriter_agent** (key terms/summary) via Gemini and pushes a `system_message` to the Vapi Frontline Agent via the control API so numbers are injected without interrupting the call.
- **Env:** `GEMINI_API_KEY`, `VAPI_PRIVATE_KEY` (or `VAPI_API_KEY`), `VAPI_CONTROL_BASE_URL`, `SWARM_WS_PORT`.

## 2. OSINT Predictive Trigger Engine

- **Doc:** [docs/OSINT_PIPELINE.md](./OSINT_PIPELINE.md) — n8n Cron jobs, Florida/Collier County public records endpoints, Supabase Edge Function.
- **Migration:** `20250304000019_leads_trigger_event.sql` adds `trigger_event` and `trigger_event_metadata` on `leads`.
- **Edge Function:** `supabase/functions/osint-ingest` — POST `{ source, records }` to cross-reference leads (e.g. by zip) and set `trigger_event` (building_permit, notice_of_default, new_llc). Use for RENO LLC radius batches.

## 3. Vocal Biometric Routing

- **Where:** `src/app/api/webhooks/vapi-call-end/route.ts`.
- **Behavior:** Parses `user_emotion` (or `analysis.user_emotion`, `sentiment.label`, `acoustic.emotion`) from the webhook body. If value is `hesitant` or `resistant` and `call_id` is present, pushes a system message to the Vapi control API: switch to **Sandler Negative Reverse** and empathetic tone. The emotion is also stored in the call’s `extracted_data.user_emotion`.
- **Mid-call:** For live sentiment during the call, configure Vapi to send the same payload (with `call_id` and `user_emotion`) to this webhook or a dedicated endpoint so the tone shift is applied in real time.

## 4. Voice-Operated Executive CRM

- **Inbound:** `POST /api/webhooks/executive-inbound` — Twilio voice webhook. **Caller ID** is restricted to `EXECUTIVE_ALLOWED_CALLER_ID` or `KEN_PHONE_NUMBER` (only Ken’s verified cell).
- **Flow:** On allowed caller, the handler queries Supabase for overnight **Gross Pipeline Value** (sum of `calls.calculated_revenue` in last 24h by vertical), then returns **TwiML** with a brief audio summary (Re4lty Inc, Wolf Insurance, Dos Mortgage, RENO, Laenan) and a **Gather** for voice commands.
- **Commands:** `POST /api/webhooks/executive-command` handles Twilio speech results: e.g. “Pause the RENO LLC campaign” (sets company active_status), “Send the Laenan processing links to the hot leads” (calls `N8N_LAENAN_LINKS_WEBHOOK_URL` with lead list).
- **Env:** `EXECUTIVE_ALLOWED_CALLER_ID` or `KEN_PHONE_NUMBER`, `N8N_LAENAN_LINKS_WEBHOOK_URL` (optional). Point your Twilio number’s voice webhook to `https://<your-domain>/api/webhooks/executive-inbound`.
