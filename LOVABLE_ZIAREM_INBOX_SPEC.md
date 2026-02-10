# Ziarem Inbox – Lovable copy-paste spec

Copy the block below into Lovable to build the Ziarem Inbox module.

---

```
Build the 'Ziarem Inbox' module. Layout: 3-Pane design (Folders | Email List | Reading Pane).

Feature 1: The 'All-In-One' Feed
- The Email List should show emails from ALL my businesses (Lyco, Wolf, Dispute) mixed together, sorted by date.
- Show a small 'Badge' next to the subject line indicating which business received it (e.g. [Lyco] vs [Wolf]).

Feature 2: The Video Composer
- Add a 'Compose' button.
- Inside the editor, add an 'Insert Video' button.
- Input: 'Paste YouTube URL'.
- Preview: Show the thumbnail with a Play button overlay immediately in the editor.

Feature 3: The Client Context
- When I click an email, the Right Pane should show the message, but ALSO show a 'History' tab with all previous emails/calls for that specific client.
```

---

## API expectations (for your backend)

- **GET /communications** – List emails (all businesses, mixed). Query params: `limit`, `offset`, optional `lead_id`. Response: `{ data: [{ id, lead_id, direction, subject, body_text, body_html, sent_at, business_id, business_name }], pagination }`. Include `business_name` (join business_emails) so the frontend can show the [Lyco] / [Wolf] badge.
- **GET /communications/:id** – Single email (for reading pane).
- **GET /communications/lead/:leadId** – History for one client (emails + place for calls) for the History tab.
- **POST /communications/send-video** – Body: `{ leadId, businessId, youtubeLink, message }`. Calls `sendVideoEmail`, returns `{ success, to, subject, sentAt }`.

The Ziarem API already exposes these routes (see `src/routes/communications.js`):

- `GET /communications?limit=50&offset=0&lead_id= optional` – all-in-one feed with `business_name` for badges
- `GET /communications/:id` – single email for reading pane
- `GET /communications/lead/:leadId` – history for client (History tab)
- `POST /communications/send-video` – body `{ leadId, businessId, youtubeLink, message? }`

Point the Ziarem Inbox frontend at your API base URL (e.g. `https://your-api.hostinger.site`).

**Businesses (for badges / send-as):** `GET /businesses` returns all Ziarem businesses (name, badge, description, ziarem_tags, services, business_id). Use for [Lyco] / [Wolf] / [Dispute] badges and for the "Send as" dropdown (business_id).
