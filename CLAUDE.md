# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
npm run dev        # Vite dev server (port 5173 or 5174)
npm run build      # Production build → dist/
npm run preview    # Preview production build
```

Deploy to Cloudflare Pages:
```bash
CLOUDFLARE_API_TOKEN=cfut_kXDg1F3CUeEGidOXD8F0lErQQ8SFY4ce7vVPVCNQ33001efc npx wrangler pages deploy dist --project-name=ziarem --branch=main
```

Auto-deploy is configured via GitHub Actions on push to `vault` branch.

## Architecture

This is a **hybrid codebase** with two coexisting systems:

### 1. Legacy Vite + React App (PRIMARY — what users see)
- **Entry**: `src/main.jsx` → `src/App.jsx` (10,800+ lines)
- **App.jsx** contains: auth, nav, dashboard, all business views, Supabase helpers, n8n proxy, team management
- **MortgagePOS.jsx** (4,500+ lines): Multi-business pipeline (6 businesses), pricing engine, 1003 application, documents, analytics, Re4lty, credit optimization, title company
- **LoanPricing.jsx**: Scenario-based mortgage pricing with Loansifter integration
- **CreditReportParser.jsx**: MyScoreIQ HTML parser, VantageScore → FICO conversion

### 2. Next.js 15 App Router (NEWER — AI sales floor dashboard)
- **Entry**: `src/app/layout.tsx` → `src/app/page.tsx` (redirects to /realty)
- **Dashboard**: `src/app/(dashboard)/` — Realty, Mortgage, Insurance verticals
- **API Routes**: `src/app/api/webhooks/` — Vapi call-end, inbound SMS, n8n callbacks
- **Live Portal**: `src/app/live/[portalId]/page.tsx` — Vapi live canvas

### Which system serves what:
- **ziarem.pages.dev** → Vite build (dist/) — the CRM users interact with
- **Next.js routes** → API webhooks and dashboard (not yet deployed to production)

## Supabase (Project: sfelhasepvaoianyuvxe)

### Client Setup
- Browser: `src/lib/supabase/client.ts` (createBrowserClient)
- Server: `src/lib/supabase/server.ts` (createServerClient with cookies)
- Admin: `src/lib/supabase/admin.ts` (service role, lazy init)
- Legacy (App.jsx): Direct REST API via `sb()`, `sbInsert()`, `sbUpdate()`, `sbDelete()` helpers

### Key Tables
- `vault_loans` — Multi-business pipeline (mortgage, insurance, RE, title, credit)
- `vault_title_orders` — Closed By Whom title orders
- `vault_programs` / `dm_lenders` — Lending programs database
- `ws_clients` / `ws_policies` / `ws_quote_requests` — Wolf Surety insurance
- `contacts` — Unified contact database
- `leads` — AI sales floor leads with propensity scoring
- `calls` — Call transcripts, recordings, extracted data
- `companies` — Business verticals (Re4lty, Dos Mortgage, Wolf Insurance, etc.)
- `cross_sells` — Cross-sell tracking between verticals

### 51+ Edge Functions
All deployed at `https://sfelhasepvaoianyuvxe.supabase.co/functions/v1/{name}`. Key ones:
- `ai-dialer` (v7) — Bilingual cold caller with ElevenLabs voice (Paola)
- `mls-bridge` — Miami MLS listings via Bridge API (dataset: miamire)
- `client-portal` — Bilingual 31-loan-type application portal
- `clawbot` — Ken AI assistant (20 intents)
- `deal-intelligence` (v3) — Property analysis with 8 free data sources
- `lead-generator` — 8 lead generation strategies
- `ivr-system` — 6-department bilingual phone system
- `cbw-portal` — Closed By Whom admin + client portal

## Multi-Business Pipeline (MortgagePOS.jsx)

The BUSINESSES array at the top of MortgagePOS.jsx defines 6 businesses, each with custom stages, services, and colors:
1. **DOS Mortgage** (gold) — Lead → Pre-Qual → Processing → Underwriting → CTC → Funded
2. **Wolf Insurance** (green) — New Quote → Quoting → Reviewing → Binding → Active
3. **Re4lty** (blue) — Lead → Showing → Offer → Under Contract → Closing → Sold
4. **Credit Optimization** (amber) — admin-only, FCRA dispute letters
5. **Laenan Group** (purple) — Consulting → Proposal → Active → Complete
6. **Closed By Whom** (violet) — New Order → Title Search → Commitment → Closing → Recorded

## Styling

- **Vite app**: All inline styles. Constants at top of each component (BG, CARD, BORDER, GOLD, TXT, DIM, etc.)
- **Next.js app**: Tailwind CSS with shadcn/ui components, HSL color variables
- **Theme**: Dark luxury — #0a0a12 bg, #d4af37 gold, #f0ece4 warm white
- **No CSS modules** — everything inline or Tailwind utility classes

## External Integrations

- **Twilio**: 6 numbers, 2 accounts — calls, SMS, WhatsApp, IVR
- **ElevenLabs**: Voice ID J4vZAFDEcpenkMp3f3R9 (Paola/Valentina Colombian voice)
- **Bridge API**: Miami MLS (miamire dataset), Server Token auth
- **Loansifter**: Mortgage pricing, Widget API Key
- **Mercury**: Banking API for DOS Mortgage + ALDA Group (Laenan)
- **First American AgentNet**: AGENTNETWS + Production keys for title
- **Plaid**: Bank verification (sandbox mode)
- **Resend**: Email sending API
- **Vapi**: AI telephony, call transcription, live canvas
- **Google Gemini**: Data extraction from call transcripts
- **n8n**: 13 automation workflows at n8n.srv1257040.hstgr.cloud

## Design Rules

Always use these 4 design tools: **UI UX Pro Max**, **Google Stitch**, **Nano Banana 2**, **21st.dev**

- Never say "credit repair" — use "credit optimization" or "mejoramiento de credito"
- Never say company names in cold calls
- Default language: Spanish first, press 2 for English
- Colombian Spanish style: usted, plata, dale, listo, minuticos
- Email scanning: always mark emails back as UNREAD after reading
- AI voice name: "Paola" (Colombian)
- Closings: 7-21 days

## 5 Telegram Bots

| Bot | Handle | Business |
|-----|--------|----------|
| Ziarem | @Ziarem_bot | Admin, daily reports |
| Wolf Insurance | @WolfInsurancebot | Insurance |
| Re4lty | @Re4ltybot | Real estate |
| CBW | @Closedbwbot | Title/closings |
| DOS Mortgage | @dosmortgage_bot | Mortgage |

All webhooks → `telegram-actions` Edge Function. Ken's chat ID: 284251009.

## Websites

| Site | Hosting | Notes |
|------|---------|-------|
| ziarem.com | Cloudflare Pages | CRM app (Vite build) |
| closedbywhom.com | Hostinger | 9 static HTML pages |
| laenan.com | Hostinger | Static (WordPress disabled) |
| dosmortgage.com | Hostinger | Static (WordPress disabled) |
| re4lty.com | Hostinger | Static HTML |
| wolfsurety.com | Hostinger | Existing design (don't change) |

Hostinger FTP: 156.67.72.214, user u966192992, domains at /domains/{site}/public_html/

## Data Flow: Call-End Pipeline

1. Vapi sends transcript → `/api/webhooks/vapi-call-end`
2. Gemini extracts structured data (intent, vertical, value, language)
3. Revenue calculated per vertical formula
4. Lead upserted, call inserted, cross-sells created
5. Recording uploaded to Supabase Storage
6. n8n webhook triggered for onboarding sequence
