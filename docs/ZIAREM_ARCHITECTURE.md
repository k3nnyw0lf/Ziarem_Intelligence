# Ziarem Enterprise Architecture Rules

## Mandatory Folder Structure

```
src/
├── app/
│   ├── (dashboard)/
│   │   ├── realty/          # Realty vertical view
│   │   ├── mortgage/        # Mortgage vertical view
│   │   ├── insurance/      # Insurance vertical view
│   │   ├── layout.tsx
│   │   ├── DashboardContext.tsx
│   │   └── DashboardContent.tsx
│   ├── api/
│   │   └── webhooks/
│   │       ├── vapi-call-end/route.ts   # Vapi call-end ingestion
│   │       └── n8n-cross-sell/route.ts  # n8n cross-sell workflow
├── components/
│   ├── ui/
│   ├── dashboard/
│   │   ├── LiveCallFeed.tsx
│   │   ├── PipelineMetrics.tsx
│   │   └── EntitySidebar.tsx
└── lib/
    ├── supabase/client.ts
    ├── gemini/extract.ts    # Gemini API extraction (EN/ES, Spanglish)
    └── call-end/            # Revenue, cross-sell, n8n trigger
```

## Financial Routing & Cross-Sell (Strict)

| Vertical           | Pipeline value |
|--------------------|----------------|
| Dos Mortgage LLC   | `estimated_loan_amount * 0.0275` |
| Laenan             | `1000` |
| Closed By Whom?    | `1500` |
| Wolf Insurance     | `600` |

**CROSS-SELL TRIGGER:** When a lead in **Re4lty Inc.** moves to `status = "Under Contract"`:

1. Create **child records in the `leads` table** for **Dos Mortgage, Laenan, and Closed By Whom?** linked to the parent via `parent_lead_id` and `company_id`.
2. Create/upsert rows in **`cross_sells`** for workflow status (Pending, Automated_Outreach, Closed), including Wolf Insurance.

## Language

All UI, database fields, and automated emails support **EN** and **ES**. Transcripts may be code-switched (Spanglish); **Gemini API** (`lib/gemini/extract.ts`) is the router for extraction.

## Tech Stack

- Frontend: Next.js 14+ (App Router), React, Tailwind, Shadcn UI, Lucide Icons
- Backend: Supabase (Postgres, Edge Functions, Auth)
- Telephony/Routing: Vapi, n8n webhooks, Gemini API
