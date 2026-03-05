# Phase 8: OSINT Predictive Trigger Engine (Collier County Focus)

## Overview

n8n Cron Job architecture that scrapes Florida/Collier County public records, ingests into Supabase, cross-references the 10M `leads` database, and flags leads with `trigger_event`. Used to generate localized call batches (e.g. RENO LLC for permits in radius).

---

## 1. Public Records API Endpoints (Florida / Collier County)

### Building Permits
- **Collier County Building Permits**  
  - Source: Collier County Gov / Accela or similar.  
  - Typical pattern: REST or CSV export of recently issued permits (address, parcel, date, type).  
  - Suggested n8n nodes: **Schedule Trigger (Cron)** → **HTTP Request** (or **Spreadsheet File** if CSV download) → map to `{ address, permit_type, issue_date, source_url }`.

- **Florida DBPR / County building departments**  
  - Some counties expose permit search APIs; others require scraping or CSV.  
  - Endpoint pattern: `https://<county>.gov/.../permits` or data portal URL. Document the exact URL and auth (if any) in your n8n workflow.

### Notice of Default (NOD)
- **County Clerk / Recorder**  
  - Lis pendens and NOD are often in clerk/recorder search.  
  - Collier: Collier Clerk of Court or county recorder site.  
  - Typical: search by date range, export or scrape `{ document_type, property_address, filing_date, case_number, source_url }`.

- **Third-party aggregators**  
  - Some data vendors (e.g. Attom, CoreLogic) expose NOD/foreclosure APIs; use if available and compliant with licensing.

### New LLC Registrations
- **Florida Division of Corporations (Sunbiz)**  
  - Search: https://dos.myflorida.com/sunbiz/  
  - Bulk/new filings: check for CSV or API; otherwise scrape search results.  
  - Payload: `{ entity_name, filing_date, registered_agent_address, source_url }`.

---

## 2. n8n Cron Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│ Schedule        │────▶│ HTTP Request /   │────▶│ Supabase Edge       │
│ (e.g. daily     │     │ Scrape (per      │     │ Function            │
│  2am ET)        │     │ source)          │     │ osint-ingest        │
└─────────────────┘     └──────────────────┘     └──────────┬──────────┘
                                                             │
                                                             ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│ RENO LLC         │◀────│ n8n: Match       │◀────│ leads with          │
│ Call batch       │     │ trigger_event +  │     │ trigger_event set    │
│ (radius/zip)     │     │ location/radius  │     │ + metadata          │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
```

### Recommended n8n Workflows

1. **OSINT – Building Permits (Collier)**  
   - **Cron:** Daily at 2:00 AM ET.  
   - **Step 1:** HTTP Request or CSV node to fetch latest permits (Collier County or configured URL).  
   - **Step 2:** Map to canonical format: `{ event_type: "building_permit", address, city, state, zip, issue_date, source_url, raw }`.  
   - **Step 3:** POST to Supabase Edge Function `osint-ingest` (see below) with body `{ source: "collier_permits", records: [...] }`.

2. **OSINT – Notice of Default**  
   - **Cron:** Daily or twice weekly.  
   - **Step 1:** Fetch NOD/lis pendens from clerk/recorder (or vendor API).  
   - **Step 2:** Map to `{ event_type: "notice_of_default", property_address, filing_date, case_number, source_url, raw }`.  
   - **Step 3:** POST to `osint-ingest` with `{ source: "nod", records: [...] }`.

3. **OSINT – New LLC (Florida)**  
   - **Cron:** Weekly.  
   - **Step 1:** Fetch new LLC filings (Sunbiz or partner feed).  
   - **Step 2:** Map to `{ event_type: "new_llc", entity_name, filing_date, address, source_url, raw }`.  
   - **Step 3:** POST to `osint-ingest` with `{ source: "sunbiz_llc", records: [...] }`.

4. **RENO LLC – Permit-based call batch**  
   - **Trigger:** After OSINT ingest or on schedule.  
   - **Step 1:** Query Supabase (or internal API) for leads where `trigger_event = 'building_permit'` and optional radius/zip.  
   - **Step 2:** Filter by `trigger_event_metadata->>'address'` or zip in lead location.  
   - **Step 3:** Export list for Vapi outbound or n8n “Create call batch” node.

---

## 3. Supabase Edge Function: `osint-ingest`

- **URL:** `https://<project>.supabase.co/functions/v1/osint-ingest`  
- **Method:** POST  
- **Headers:** `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` (or Anon + RLS if you add a dedicated policy).  
- **Body:**
  ```json
  {
    "source": "collier_permits",
    "records": [
      {
        "event_type": "building_permit",
        "address": "123 Main St",
        "city": "Naples",
        "state": "FL",
        "zip": "34102",
        "issue_date": "2025-03-01",
        "source_url": "https://..."
      }
    ]
  }
  ```

The function will:
1. Normalize address/zip for matching.  
2. Cross-reference `leads` (e.g. by `location`, normalized address, or zip in a 10M table — use indexed columns and batching).  
3. For each matched lead, set `trigger_event` and `trigger_event_metadata` (source_url, date, address, etc.).  
4. Optionally enqueue or flag for “RENO LLC radius batch” when `event_type = building_permit`.

---

## 4. Database

- **Leads table** (see migration `20250304000019_leads_trigger_event.sql`):
  - `trigger_event` (text): e.g. `building_permit`, `notice_of_default`, `new_llc`.
  - `trigger_event_metadata` (jsonb): `{ source_url, date, address, ... }`.

---

## 5. Collier County – Example Endpoints (to be configured)

| Data type        | Suggested endpoint / source                    | Notes                    |
|------------------|-------------------------------------------------|--------------------------|
| Building permits | Collier County building/code enforcement portal| CSV or REST if offered   |
| NOD / Lis pendens| Collier Clerk of Court / Recorder               | Search by date range     |
| New LLC          | Sunbiz (FL Division of Corporations)           | Bulk or search + scrape  |

Replace with your actual vendor or county URLs and store them in n8n credentials or env.

---

## 6. Security and Compliance

- Respect robots.txt and terms of use for any scraping.  
- Prefer official APIs or licensed data when available.  
- Store only what’s needed for matching and compliance; avoid retaining full document text unless required.
