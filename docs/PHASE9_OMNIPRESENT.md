# Phase 9: Omnipresent Intelligence

## 1. Physical Geo-Interception Webhook

- **Endpoint:** `POST /api/webhooks/geo-intercept`
- **Payload (e.g. Radar.com):** `device_id`, `latitude`, `longitude`, `timestamp`, optional `phone_number`
- **Behavior:** Location is mapped to competitor geofences (e.g. "Competitor Mortgage Broker" in Naples). Lead is resolved by `device_id` (table `lead_devices`) or by `phone_number` in `leads`. If matched, a row is inserted into `intercept_queue` with `scheduled_before_at` = now + 15 min.
- **Tables:** `lead_devices` (lead_id ↔ device_id), `intercept_queue` (lead_id, geofence_name, status: pending | dispatched | completed | expired)
- **Next step:** A worker or n8n workflow should poll `intercept_queue` for `status = 'pending'` and `scheduled_before_at > now()`, then trigger Vapi to place an "Intercept Call" to that lead and set status to `dispatched`.

---

## 2. Lifetime Digital Twin Engine (WhatsApp/SMS)

- **Lib:** `src/lib/agents/digital-twin.ts`
- **Cron:** `GET/POST /api/cron/digital-twin` (secure with `Authorization: Bearer <CRON_SECRET>`)
- **Flow:** Queries `leads` where `status = 'Closed'`. Fetches NOAA/NWS alerts (Florida) and Treasury rate data. For Collier County weather (e.g. Hurricane Watch) or rate drop, uses Gemini to draft a hyper-personalized SMS and sends via Twilio (RENO LLC storm prep, Dos Mortgage refi, etc.).
- **Env:** `GEMINI_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `CRON_SECRET`
- **n8n:** Schedule a Cron that calls `https://<your-domain>/api/cron/digital-twin` with the Bearer token every 6–12 hours.

---

## 3. Real-Time Generative Vision (RENO LLC / Re4lty)

- **Vapi tool:** `generate_vision_render` — see `src/lib/vapi/systemPrompt.ts` and `GENERATE_VISION_RENDER_TOOL`
- **Webhook:** `POST /api/webhooks/vision-render`  
  Body: `property_address`, `desired_style`, `prospect_phone`, optional `lead_id`
- **Flow:** Optionally fetch property image from `VISION_RENDER_IMAGE_API_URL` (POST `{ address }` → `{ image_url }`). Optionally call `VISION_RENDER_STYLE_API_URL` (POST `{ address, style }` → `{ image_url }`) to apply style. SMS the image URL (or a “we’re preparing…” message) to the prospect via Twilio.
- **n8n:** Can call the same webhook with address, style, and phone; or Vapi tool serverUrl points to this route.
- **Env:** `TWILIO_*`, `VISION_RENDER_IMAGE_API_URL`, `VISION_RENDER_STYLE_API_URL` (optional)

---

## 4. Entity Resolution & Network Graphing

- **Table:** `network_graph` — `id`, `primary_lead_id`, `connected_person_name`, `connected_phone`, `relationship_type` (Family | Business Partner | Other), `warm_intro_status` (pending | contacted | converted | skipped)
- **n8n workflow (trigger: lead status = Closed):**
  1. On lead update to `Closed`, trigger the workflow.
  2. Call a data enrichment API (e.g. Clearbit, People Data Labs, or internal) with the lead’s email/phone to get 1st-degree connections.
  3. For each connection, `INSERT` into `network_graph` (primary_lead_id, connected_person_name, connected_phone, relationship_type, warm_intro_status = 'pending').
  4. Flag rows with `warm_intro_status = 'pending'` for a "Warm Intro" AI call campaign; the AI script should reference the primary lead by name to establish trust.
- **API (optional):** Expose `GET /api/network-graph?primary_lead_id=...` or a Supabase view so the campaign dialer can pull pending connections.
