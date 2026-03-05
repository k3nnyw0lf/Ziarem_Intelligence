# Cole Data Dictionary – CRM alignment

This CRM is aligned to **Cole_Data Dictionary_Apr2024.xlsx** (sheet: **FA + CP Data Appended**).

## Source of truth

- **Dictionary file:** `Cole_Data Dictionary_Apr2024.xlsx` (e.g. in Downloads).
- **Exported CSV:** `data/FA + CP Data Appended.csv` (Column_name, Type, Length).  
  Regenerate from the xlsx:
  ```bash
  node scripts/export_cole_dictionary_to_csv.js "c:\Users\Kenne\Downloads\Cole_Data Dictionary_Apr2024.xlsx"
  ```

## Column mapping (Cole → CRM)

| Cole name (xlsx/CSV)     | CRM schema / import |
|--------------------------|----------------------|
| `autoId_ui#`             | `autoId_ui` (PK)     |
| `mobile_ui#`             | `mobile_ui`          |
| `CurrentSaleDocumentType`| `doc_type_code` (FK → dict_doc_types) |
| `PropertyClassID`       | `prop_cl_ind` (FK → dict_property_class) |
| `Address Type`           | `address_type`       |

All other columns use the same name in the CRM (e.g. `first_name`, `zip_code`, `occupation_code`, `YearBuilt`, `PoolCode`, `RoofCoverCode`).

## Lookup tables (from same Data Dictionary)

Seeded from CSVs that match the dictionary code tables:

| CRM table            | Source CSVs                |
|----------------------|----------------------------|
| dict_occupations     | Occupation.csv, Occupation Code.csv |
| dict_doc_types       | DOC_TYPE.csv               |
| dict_property_class  | PROP_CL_IND.csv            |

Run: `node seed_dictionaries.js [directory]` (default: `data/dictionaries`).

## Businesses and services (single source of truth)

All Ziarem businesses and services are defined in **config/businesses.js**. Used by lead tagging (`ziarem_tags`), inbox badges, and **GET /businesses**.

| Business | Badge | ziarem_tags (examples) |
|----------|--------|------------------------|
| Wolf Surety & Reno LLC | Wolf Reno | WOLF_RENO_TARGET |
| Dispute LLC | Dispute | DISPUTE_DISTRESSED |
| Lyco Inc | Lyco | LYCO_TAX_LEAD |
| Dos Mortgage & Laenan | Dos | DOS_REFI_TARGET, DOS_FIRST_TIME_BUYER |
| Re4lty & Closed By Whom | Re4lty | RE4LTY_FLIP_OPPORTUNITY, CLOSED_BY_WHOM_TITLE |
| Wolf Insurance | Wolf Ins | WOLF_INSURANCE_LIABILITY, WOLF_INSURANCE_HIGH_RISK |

- **API:** `GET /businesses` returns the full list (name, badge, description, ziarem_tags, services, business_id if seeded).
- **Inbox:** Seed email placeholders with `node scripts/seed_business_emails.js`; then update `business_emails` with real SMTP/IMAP.

## Import

- **Lead file:** Any CSV whose headers match the Cole FA + CP column names (or the mapped names above).
- **Script:** `node import_and_score.js <path-to-leads.csv>`
- **Logic:** Ziarem tags (per config/businesses.js) are applied per row and stored in `ziarem_tags` (JSONB).

## Schema

- **Main table:** `leads` in `schema.sql` (FA + CP columns + `ziarem_tags`).
- **Communications:** `database/communications.sql` (business_emails, communications).

To refresh the leads table definition from the exported CSV (optional):

```bash
node scripts/generate_raw_leads_schema.js "data/FA + CP Data Appended.csv"
# Output: database/schema/004_raw_leads.sql (reference; main CRM table is in schema.sql)
```
