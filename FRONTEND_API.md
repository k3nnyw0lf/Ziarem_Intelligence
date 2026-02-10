# Connect the frontend to the Hostinger API (real data)

Point your frontend (e.g. Lovable app) at your Hostinger API base URL so it fetches **real leads and emails** instead of mock data.

---

## 1. Set the API base URL

Use your **Hostinger API URL** (no trailing slash), e.g.:

- `https://your-app.hostinger.site`
- `https://api.yourdomain.com`

**In Lovable**

- **Settings** or **Environment** → add a variable, e.g. `VITE_API_URL` or `REACT_APP_API_URL`.
- Set the value to your Hostinger API URL.
- In code, use: `const API_URL = import.meta.env.VITE_API_URL || ''` (Vite) or `process.env.REACT_APP_API_URL` (CRA).

**Local dev**

- Use the same env var and set it to `http://localhost:3000` when running the API locally.

---

## 2. Endpoints and response shapes

All responses are JSON. The API sends **CORS** headers so the browser can call it from your frontend origin.

### Leads

| Method | URL | Description |
|--------|-----|-------------|
| GET | `/leads?limit=50&offset=0` | Paginated list. Optional: `?total=0` to skip count. |
| GET | `/leads/:id` | **Lead detail**: full contact info, scoring breakdown (ziarem_tags + business labels), and communication history. Use when user clicks a lead row. |

**Response**

```json
{
  "data": [
    {
      "autoId_ui": 12345,
      "id": 12345,
      "first_name": "Jane",
      "last_name": "Doe",
      "email_addr": "jane@example.com",
      "email": "jane@example.com",
      "phone_nbr": "555-1234",
      "mobile_phone": "555-9999",
      "phone": "555-1234",
      "ziarem_tags": ["LYCO_TAX_LEAD"],
      "business_tags": ["LYCO_TAX_LEAD"],
      "address_1": "123 Main St",
      "city": "Austin",
      "state": "TX",
      "zip_code": "78701"
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "total": 1000,
    "hasMore": true
  }
}
```

Use **id** (or **autoId_ui**) and **email** (or **email_addr**) for display and for linking to communications.

**GET /leads/:id** (lead detail – open when clicking a row)

```json
{
  "lead": {
    "id": 12345,
    "autoId_ui": 12345,
    "first_name": "Jane",
    "middle_init": "M",
    "last_name": "Doe",
    "name_suffix": null,
    "full_name": "Jane M Doe",
    "DOB": null,
    "gender_cd": null,
    "address_1": "123 Main St",
    "address_2": "Apt 4",
    "city": "Austin",
    "state": "TX",
    "zip_code": "78701",
    "zip_cd_4": null,
    "phone_nbr": "555-1234",
    "mobile_phone": "555-9999",
    "email_addr": "jane@example.com",
    "home_owner_flag": "Y",
    "home_value": 450000,
    "home_market_value": 480000,
    "length_of_residence": null,
    "credit_rating": "A",
    "occupation_code": "11",
    "occupation": "Self Employed",
    "doc_type_code": null,
    "lat": 30.27,
    "lon": -97.74
  },
  "scoring": {
    "tags": ["LYCO_TAX_LEAD"],
    "breakdown": [
      {
        "tag": "LYCO_TAX_LEAD",
        "business": "Lyco Inc",
        "badge": "Lyco",
        "description": "Tax and high-net-worth leads..."
      }
    ],
    "enrichment": { "email": {...}, "phone": {...}, "updated_at": "..." }
  },
  "communications": [
    {
      "id": 1,
      "lead_id": 12345,
      "direction": "INBOUND",
      "subject": "Re: Your inquiry",
      "body_text": "...",
      "body_html": "<p>...</p>",
      "sent_at": "2025-02-09T12:00:00.000Z",
      "business_id": 1,
      "business_name": "Lyco Inc"
    }
  ]
}
```

Use **lead** for the contact card, **scoring.breakdown** for the scoring section (tag + business + description), and **communications** for the history list.

---

### Communications (emails)

| Method | URL | Description |
|--------|-----|-------------|
| GET | `/communications?limit=50&offset=0&lead_id=123` | All-in-one feed. Optional `lead_id` to filter by lead. |
| GET | `/communications/:id` | Single email (reading pane). |
| GET | `/communications/lead/:leadId` | History for one client (History tab). |
| POST | `/communications/send-video` | Send video email. Body below. |

**GET /communications** response

```json
{
  "data": [
    {
      "id": 1,
      "lead_id": 12345,
      "direction": "INBOUND",
      "subject": "Re: Your inquiry",
      "body_text": "...",
      "body_html": "<p>...</p>",
      "sent_at": "2025-02-09T12:00:00.000Z",
      "business_id": 1,
      "business_name": "Lyco Inc"
    }
  ],
  "pagination": { "limit": 50, "offset": 0, "total": 42, "hasMore": false }
}
```

Use **business_name** for the inbox badge (e.g. [Lyco], [Wolf]).

**POST /communications/send-video** body

```json
{
  "leadId": 12345,
  "businessId": 1,
  "youtubeLink": "https://www.youtube.com/watch?v=...",
  "message": "Optional short message"
}
```

Response: `{ "success": true, "to": "jane@example.com", "subject": "...", "sentAt": "..." }`.

---

### Businesses (for inbox badges and “Send as” dropdown)

| Method | URL |
|--------|-----|
| GET | `/businesses` |

**Response**

```json
{
  "data": [
    {
      "name": "Lyco Inc",
      "badge": "Lyco",
      "description": "...",
      "ziarem_tags": ["LYCO_TAX_LEAD"],
      "services": ["Tax leads", "High-net-worth"],
      "business_id": 1
    }
  ]
}
```

Use **business_id** when calling `POST /communications/send-video`. Use **badge** for [Lyco] / [Wolf] labels.

---

## 3. Example: replace mock data with real API

**Fetch leads (paginated)**

```javascript
const API_URL = import.meta.env.VITE_API_URL || '';

async function fetchLeads(limit = 50, offset = 0) {
  const res = await fetch(
    `${API_URL}/leads?limit=${limit}&offset=${offset}`
  );
  if (!res.ok) throw new Error('Failed to fetch leads');
  return res.json();
}
```

**Fetch lead detail (on row click – contact, scoring, history)**

```javascript
async function fetchLeadDetail(leadId) {
  const res = await fetch(`${API_URL}/leads/${leadId}`);
  if (!res.ok) throw new Error('Failed to fetch lead detail');
  return res.json();
}
// Returns { lead, scoring: { tags, breakdown, enrichment }, communications }
```

**Fetch all-in-one email feed**

```javascript
async function fetchCommunications(limit = 50, offset = 0, leadId = null) {
  let url = `${API_URL}/communications?limit=${limit}&offset=${offset}`;
  if (leadId != null) url += `&lead_id=${leadId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch communications');
  return res.json();
}
```

**Fetch lead history (History tab)**

```javascript
async function fetchLeadHistory(leadId) {
  const res = await fetch(`${API_URL}/communications/lead/${leadId}`);
  if (!res.ok) throw new Error('Failed to fetch history');
  const json = await res.json();
  return json.data;
}
```

**Fetch businesses (badges / send-as)**

```javascript
async function fetchBusinesses() {
  const res = await fetch(`${API_URL}/businesses`);
  if (!res.ok) throw new Error('Failed to fetch businesses');
  const json = await res.json();
  return json.data;
}
```

**Send video email**

```javascript
async function sendVideoEmail(leadId, businessId, youtubeLink, message = '') {
  const res = await fetch(`${API_URL}/communications/send-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      leadId,
      businessId,
      youtubeLink,
      message,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to send');
  }
  return res.json();
}
```

---

## 4. Checklist

- [ ] Set **VITE_API_URL** (or **REACT_APP_API_URL**) to your Hostinger API URL in the frontend env.
- [ ] Replace any mock leads list with `GET /leads` (use `data` and `pagination`).
- [ ] Replace mock inbox with `GET /communications` (use `data` and `business_name` for badges).
- [ ] Replace mock “Send as” options with `GET /businesses` and use `business_id` in `POST /communications/send-video`.
- [ ] Use `GET /communications/lead/:leadId` for the client History tab.
- [ ] Ensure the API is deployed on Hostinger with **CORS** enabled (this repo enables it for all origins).

If the API is on a different domain than the frontend, the browser will allow it as long as the API responds with the CORS headers (already configured in this backend).
