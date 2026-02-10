# Lead detail view – Lovable spec

When the user clicks a lead row in the leads list, open a **lead detail view** (drawer, modal, or side panel) that shows full contact info, scoring breakdown, and communication history. Data comes from **GET /leads/:id**.

---

Copy the block below into Lovable:

```
Add a lead detail view that opens when the user clicks a row in the leads list.

1. On row click: call GET /leads/{id} (id = lead id from the row). Show a loading state.

2. Layout (e.g. drawer or modal):
   - **Contact**: Full name, email, phone(s), address (address_1, address_2, city, state, zip). Optionally: DOB, home value, credit rating, occupation.
   - **Scoring breakdown**: For each tag in scoring.breakdown, show: tag name, business name (or badge), and description. If scoring.enrichment exists, show a short "Enrichment" section (e.g. email valid, phone valid).
   - **Communication history**: List scoring.communications (or communications from the response). Each item: direction (INBOUND/OUTBOUND), subject, sent_at, business_name. Clicking an item can expand or open the email body.

3. Use the same API base URL (e.g. VITE_API_URL). Endpoint: GET /leads/:id. Response shape: { lead, scoring: { tags, breakdown, enrichment }, communications }.
```

---

## API

- **GET /leads/:id** – Returns:
  - **lead** – Full contact (id, full_name, first_name, last_name, email_addr, phone_nbr, mobile_phone, address_1, address_2, city, state, zip_code, DOB, home_value, home_market_value, credit_rating, occupation, occupation_code, doc_type_code, lat, lon, etc.).
  - **scoring** – **tags** (array of tag codes), **breakdown** (array of { tag, business, badge, description }), **enrichment** (cached email/phone validation if present).
  - **communications** – Array of { id, lead_id, direction, subject, body_text, body_html, sent_at, business_id, business_name }.

See [FRONTEND_API.md](FRONTEND_API.md) for the full response shape and example `fetchLeadDetail(leadId)`.
