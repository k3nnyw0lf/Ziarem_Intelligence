/**
 * Ziarem Inbox routes — backfill control, triage status, AI cost report,
 * AI lender-product recommendation for a lead.
 */

const express = require('express');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { pool } = require('../db');
const { llm, dailyReport, getRoutingPlan } = require('../llm/router');

const router = express.Router();

// Track running backfill children (one per business at a time).
const running = new Map();

router.get('/status', async (_req, res) => {
  try {
    const businesses = await pool.query(
      `SELECT id, business_name, business_tag, is_active, last_imap_sync_at,
              backfill_started_at, backfill_completed_at, backfill_through_date, last_sync_error
         FROM business_emails ORDER BY id`
    );
    const queue = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE ai_processed_at IS NULL AND direction = 'INBOUND')   AS pending_triage,
         COUNT(*) FILTER (WHERE ai_processed_at IS NOT NULL)                          AS triaged,
         COUNT(*) FILTER (WHERE ai_error IS NOT NULL)                                 AS errored,
         COUNT(*) FILTER (WHERE ai_attempts >= 3 AND ai_processed_at IS NULL)         AS dead_letter,
         COUNT(*)                                                                      AS total_messages
       FROM communications`
    );
    const matched = await pool.query(
      `SELECT COUNT(DISTINCT lead_id) AS leads_with_email FROM communications WHERE lead_id IS NOT NULL`
    );
    res.json({
      businesses: businesses.rows,
      queue: queue.rows[0],
      crm: matched.rows[0],
      backfill_running: Array.from(running.keys()),
    });
  } catch (err) {
    console.error('GET /inbox/status', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/backfill', async (req, res) => {
  const { business_id, years } = req.body || {};
  const key = business_id ? `b${business_id}` : 'all';
  if (running.has(key)) return res.status(409).json({ error: `backfill already running for ${key}` });

  const args = [];
  if (years) args.push('--years', String(Number(years)));
  if (business_id) args.push('--business', String(Number(business_id)));

  const child = spawn('node', [path.join(__dirname, '..', '..', 'imap_backfill.js'), ...args], {
    cwd: path.join(__dirname, '..', '..'),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running.set(key, { pid: child.pid, started_at: new Date() });
  let log = '';
  child.stdout.on('data', (d) => { log += d.toString(); });
  child.stderr.on('data', (d) => { log += d.toString(); });
  child.on('close', () => running.delete(key));

  res.json({ accepted: true, key, pid: child.pid, started_at: new Date().toISOString() });
});

router.get('/cost-report', async (req, res) => {
  try {
    const days = Number(req.query.days || 7);
    const report = await dailyReport(days);
    const plan = await getRoutingPlan('chat');
    const totals = report.reduce(
      (acc, r) => {
        acc.actual += Number(r.actual_cost_usd) || 0;
        acc.hypothetical += Number(r.hypothetical_sonnet_cost_usd) || 0;
        acc.savings += Number(r.savings_vs_sonnet_usd) || 0;
        acc.calls += Number(r.total_calls) || 0;
        return acc;
      },
      { actual: 0, hypothetical: 0, savings: 0, calls: 0 }
    );
    res.json({ days, totals, by_day: report, available_now: plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/recommend-product', async (req, res) => {
  try {
    const { lead_id, scenario } = req.body || {};
    if (!lead_id && !scenario) return res.status(400).json({ error: 'lead_id or scenario required' });

    let leadCtx = null;
    if (lead_id) {
      const r = await pool.query(
        `SELECT autoId_ui, first_name, last_name, email_addr, phone_nbr, mobile_phone, city, state, zip_code,
                income, credit_rating, home_value, home_owner_flag, occupation, MortgageAmountinThousands,
                Mortgageloantype, FirstMtgInterestRateType, lead_score, ziarem_tags
           FROM leads WHERE autoId_ui = $1`,
        [lead_id]
      );
      leadCtx = r.rows[0] || null;
    }

    const products = await pool.query(
      `SELECT p.id, p.name, p.product_type, p.rate_min, p.rate_max, p.ltv_max, p.fico_min, p.dti_max,
              p.loan_amount_min, p.loan_amount_max, p.occupancy, p.property_types, p.requirements_md, p.notes_md,
              l.name AS lender_name, l.slug AS lender_slug
         FROM lender_kb_products p
         JOIN lender_kb_lenders l ON l.id = p.lender_id
        WHERE p.is_active = TRUE
        ORDER BY p.lender_id, p.product_type
        LIMIT 50`
    );

    if (products.rows.length === 0) {
      return res.json({
        recommendation: 'No active lender products in lender_kb_products yet — populate via /api/lender-products POST or rate-sheet ingestion.',
        lead: leadCtx,
        products: [],
      });
    }

    const recentEmails = lead_id ? (await pool.query(
      `SELECT subject, body_text, ai_summary, ai_intent, sent_at
         FROM communications WHERE lead_id = $1 ORDER BY sent_at DESC LIMIT 5`,
      [lead_id]
    )).rows : [];

    const system = `You are Ziarem's loan recommendation AI. Given a lead's profile, recent emails,
and a list of available products from Laenan/DOS Mortgage, return the 3 best-fit products,
ranked, with concrete reasoning per product, and a draft outreach email to the lead.

Output JSON ONLY:
{
  "ranked": [{
    "product_id": "uuid",
    "score": 0-100,
    "reasons": ["..."],
    "missing_info": ["FICO", "DTI", ...]
  }],
  "draft_email": { "subject": "...", "body": "..." },
  "next_step": "..."
}`;

    const user = JSON.stringify({
      lead: leadCtx,
      scenario: scenario || null,
      recent_emails: recentEmails,
      products: products.rows,
    }, null, 2);

    const out = await llm.json({
      task: 'recommend',
      system,
      user,
      maxTokens: 2048,
      lead_id: lead_id || null,
      // Recommendation is the one place we accept paid Anthropic if free tiers can't reason well enough
      // — but the router still tries free first.
    });

    res.json({
      recommendation: out.json,
      provider: out.provider,
      model: out.model,
      cost_usd: out.est_cost_usd || 0,
      lead: leadCtx,
    });
  } catch (err) {
    console.error('POST /inbox/recommend-product', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/threads', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const businessId = req.query.business_id ? Number(req.query.business_id) : null;
    const params = [limit, offset];
    let where = '';
    if (businessId) { where = 'WHERE business_id = $3'; params.push(businessId); }
    const r = await pool.query(
      `SELECT * FROM v_inbox_threads ${where} ORDER BY last_message_at DESC LIMIT $1 OFFSET $2`,
      params
    );
    res.json({ data: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q required' });
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const r = await pool.query(`SELECT * FROM search_communications_hybrid($1, NULL, NULL, $2)`, [q, limit]);
    res.json({ data: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
