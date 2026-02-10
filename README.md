# Ziarem Intelligence

API and database for Ziarem leads (PostgreSQL + Node.js).

**Connect to Lovable, GitHub, and Hostinger:** see [CONNECT.md](CONNECT.md).

## Database (Hostinger VPS)

1. Create a database named `ziarem` in your Hostinger control panel (PostgreSQL).
2. Run the schema on that database:

```bash
psql -h YOUR_HOST -U YOUR_USER -d ziarem -f database/schema/001_create_leads.sql
psql -h YOUR_HOST -U YOUR_USER -d ziarem -f database/schema/002_add_cole_lead_fields.sql
psql -h YOUR_HOST -U YOUR_USER -d ziarem -f database/schema/003_create_dictionary_tables.sql
psql -h YOUR_HOST -U YOUR_USER -d ziarem -f database/schema/004_raw_leads.sql
psql -h YOUR_HOST -U YOUR_USER -d ziarem -f database/schema/005_view_hot_leads.sql
```

Or paste the contents into Hostinger’s phpPgAdmin / SQL tool.

### Ziarem Intelligence Engine (lead scoring)

Classification runs when you need it (e.g. after inserting into `raw_leads`):

- **Wolf Surety:** `Wolf_Trade` (occupation = Contractor/Builder/Electrician/Plumber), `Distressed_Property` (doc_type = Notice of Default 77 or Foreclosure 34).
- **Dispute LLC:** `Credit_Repair_Urgent` (credit_rating Low or doc_type 77).
- **Lyco Tax:** `Lyco_HighNetWorth` (home value > $1M or net worth High), `Lyco_Business` (Self Employed / Business Owner).

**Node:** `lead_scorer.js` – `scoreLead(lead, { pool })` returns an array of tags; use from your import or API after insert.

**SQL:** View `view_hot_leads` joins `raw_leads` with `dict_occupations` and `dict_doc_types`, applies the same rules, and returns only leads with at least one tag (column `tags` is a text array).

### Dictionary lookup tables (decode codes in raw data)

| Table                 | Purpose                          |
|-----------------------|----------------------------------|
| dict_occupations      | Numeric + alpha-numeric occupation codes (Occupation.csv + Occupation Code.csv) |
| dict_doc_types        | Document type codes              |
| dict_property_types   | Property class (e.g. PROP_CL_IND) |
| dict_roof_types      | Roof type codes                  |
| dict_heating          | Heating codes                    |

Each table: `code` (VARCHAR PK), `description` (TEXT). Seed from CSV:

```bash
# Put your Data Dictionary CSVs in data/dictionaries/ then:
npm run seed-dictionaries
# Or: node seed_dictionaries.js /path/to/csv/folder
```

Expected filenames (case-insensitive): `Occupation.csv`, `Occupation Code.csv`, `DOC_TYPE.csv`, `PROP_CL_IND.csv`, `ROOF_TYPE.csv`, `HEAT.csv` (or `property_types.csv`, `roof_types.csv`, `heating.csv`).

### Raw leads table (1M+ rows)

The `raw_leads` table holds raw FA + CP data with one row per lead. It is generated from the Data Dictionary CSV so column definitions stay in sync.

- **Primary key:** `autoId_ui#`
- **Indexes:** `zip_code`, `occupation_code`, `CurrentSaleDocumentType` (doc type), `last_name`
- **Foreign keys (allow NULLs):** `occupation_code` → `dict_occupations(code)`, `CurrentSaleDocumentType` → `dict_doc_types(code)`

**Generate the schema from your CSV:**

```bash
# If you have "FA + CP Data Appended.csv" (Column_name, Type, Length):
node scripts/generate_raw_leads_schema.js "path/to/FA + CP Data Appended.csv"
# Output: database/schema/004_raw_leads.sql
```

Default input: `data/FA + CP Data Appended.csv` (a generated version exists from the FA+CP column list). Then run the migration:

```bash
psql -h YOUR_HOST -U YOUR_USER -d ziarem -f database/schema/004_raw_leads.sql
```

### Leads table (optimized for ~1M rows)

| Column         | Type                    | Notes                          |
|----------------|-------------------------|--------------------------------|
| id             | UUID                    | PK, default `gen_random_uuid()` |
| first_name     | VARCHAR(255)            |                                |
| last_name      | VARCHAR(255)            |                                |
| email          | VARCHAR(255)            | Indexed                        |
| phone          | VARCHAR(50)             | Indexed                        |
| mobile_phone   | VARCHAR(50)             | Cole: mobile_phone             |
| business_tags  | ziarem_business_tag[]   | Enum: 'Lyco', 'Wolf', 'Dispute' |
| lead_score     | SMALLINT 0–100          | Default 0                      |
| created_at     | TIMESTAMPTZ             | Default now()                  |
| source         | VARCHAR(50)             | e.g. Cole (Data Dictionary)     |
| source_id      | VARCHAR(100)            | e.g. ID_Individuals            |
| address_1      | VARCHAR(255)            |                                |
| city           | VARCHAR(100)            |                                |
| state          | VARCHAR(20)             |                                |
| zip_code       | VARCHAR(20)             | Indexed                        |

Indexes: `email`, `phone`, `created_at DESC`, `lead_score DESC`, GIN on `business_tags`, unique `(source, source_id)` for Cole dedupe.

## API (Node.js)

### Setup

```bash
npm install
cp .env.example .env
# Edit .env with your Hostinger PostgreSQL credentials
npm start
```

Dev with auto-reload: `npm run dev`.

### Endpoints

- **GET /leads** – Paginated list (server-side).

  - Query: `limit` (default 50, max 100), `offset` (default 0).
  - Example: `GET /leads?limit=50&offset=0`
  - Optional: `?total=0` to skip the total count query (faster on very large tables).

  Response:

```json
{
  "data": [
    {
      "id": "uuid",
      "first_name": "...",
      "last_name": "...",
      "email": "...",
      "phone": "...",
      "business_tags": ["Lyco", "Wolf"],
      "lead_score": 75,
      "created_at": "2025-02-09T..."
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "total": 1000000,
    "hasMore": true
  }
}
```

- **GET /health** – Health check.

## Import leads from CSV or Excel

Imports in batches of 1,000. **Cole Data Dictionary (FA + CP)** format is detected automatically (by filename or by column headers), so no mapping needed for Cole exports.

```bash
npm run import-leads -- path/to/leads.csv
node import_leads.js "path/to/Cole_Data Dictionary_Apr2024.xlsx"
node import_leads.js path/to/leads.csv
```

- **Cole format** (auto-detected): Uses columns from the [Cole Data Dictionary](https://coleinformation.com/) “FA + CP Data Appended” spec (e.g. `ID_Individuals`, `first_name`, `last_name`, `email_addr`, `phone_nbr`, `mobile_phone`, `address_1`, `city`, `state`, `zip_code`). Duplicates by `(source, source_id)` are skipped. Stored with `source = 'Cole'`.
- **Generic CSV**: `first_name`, `last_name`, `email` (required). Optional: `id` (UUID), `phone`, `business_tags`, `lead_score`, `created_at`. Rows without `email` are skipped; duplicate `id` is skipped.

## Environment

See `.env.example`. Required: `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`. Use `PGSSLMODE=require` for Hostinger.
