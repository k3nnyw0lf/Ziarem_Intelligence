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

/**
 * POST /inbox/webhook/n8n
 * Receives email payloads from n8n IMAP triggers (live monitors + backfill).
 * Auth: shared secret in X-Webhook-Secret header (set N8N_WEBHOOK_SECRET in .env).
 *
 * Accepts both n8n native IMAP node fields AND the field-name variants the
 * old Supabase edge function expected, so a single endpoint serves all workflows.
 *
 * Required body (any one shape works):
 *   { from, subject, text|body, date, message_id, to, business_tag?, source? }
 *   { from_email, from_name, subject, body_text, body_html, received_at, to_email, message_id, business_tag?, source? }
 *
 * source: 'live'|'backfill'|'master_router'  (default 'live')
 */
router.post('/webhook/n8n', express.json({ limit: '20mb' }), async (req, res) => {
  try {
    const secret = req.get('X-Webhook-Secret') || req.query.secret;
    const expected = process.env.N8N_WEBHOOK_SECRET;
    if (expected && secret !== expected) {
      return res.status(401).json({ error: 'invalid webhook secret' });
    }

    const b = req.body || {};

    // Normalize across the two shapes
    const fromEmail = String(extractEmail(b.from_email || b.from || '')).toLowerCase().trim() || null;
    const fromName  = String(b.from_name || extractName(b.from) || '').trim() || null;
    const toEmail   = Array.isArray(b.to_email || b.to) ? (b.to_email || b.to)[0] : (b.to_email || b.to);
    const toEmailNorm = String(extractEmail(toEmail || '')).toLowerCase().trim() || null;
    const subject   = String(b.subject || '').slice(0, 1000);
    const bodyText  = String(b.body_text || b.text || b.textPlain || '').slice(0, 200000);
    const bodyHtml  = b.body_html || b.html || b.textHtml || null;
    const receivedAt = b.received_at || b.date || new Date().toISOString();
    const rfc822Id  = (b.message_id || b.rfc822_message_id || '').toString().replace(/[<>]/g, '') || null;
    const inReplyTo = (b.in_reply_to || '').toString().replace(/[<>]/g, '') || null;
    const refs      = Array.isArray(b.references) ? b.references.map((r) => String(r).replace(/[<>]/g, '')) : [];
    const businessTag = b.business_tag || null;
    const source    = b.source || 'live';
    const attachments = Array.isArray(b.attachments) ? b.attachments : [];

    // Resolve business_id: prefer explicit tag → match business_emails.business_tag.
    // Fallback: match by domain of `to` address.
    let businessId = null;
    if (businessTag) {
      const r = await pool.query(`SELECT id FROM business_emails WHERE business_tag = $1 LIMIT 1`, [businessTag]);
      businessId = r.rows[0]?.id ?? null;
    }
    if (!businessId && toEmailNorm) {
      const domain = toEmailNorm.split('@')[1];
      if (domain) {
        const r = await pool.query(
          `SELECT id FROM business_emails WHERE LOWER(email_user) LIKE '%@' || $1 OR LOWER(email_user) = $2 LIMIT 1`,
          [domain, toEmailNorm]
        );
        businessId = r.rows[0]?.id ?? null;
      }
    }
    if (!businessId) {
      return res.status(400).json({ error: 'unable to resolve business — provide business_tag or ensure to= matches a business_emails.email_user' });
    }

    // Match lead by sender email (cheap pre-pass).
    const leadId = fromEmail
      ? (await pool.query(`SELECT autoId_ui FROM leads WHERE LOWER(TRIM(email_addr)) = $1 LIMIT 1`, [fromEmail])).rows[0]?.autoid_ui ?? null
      : null;

    const threadKey = inReplyTo || refs[0] || rfc822Id || ('subj:' + subject.replace(/^(re:|fwd:|fw:)\s*/gi, '').trim().toLowerCase().slice(0, 120));

    const ins = await pool.query(
      `INSERT INTO communications
        (lead_id, direction, subject, body_text, body_html, sent_at, business_id,
         rfc822_message_id, in_reply_to, message_refs, thread_key,
         from_addr, from_name, to_addrs, imap_uid,
         size_bytes, has_attachments)
       VALUES ($1, 'INBOUND', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (business_id, rfc822_message_id) WHERE rfc822_message_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        leadId, subject, bodyText, bodyHtml, receivedAt, businessId,
        rfc822Id, inReplyTo, refs, threadKey,
        fromEmail, fromName,
        toEmailNorm ? [toEmailNorm] : [],
        null, // imap_uid not provided by webhook
        bodyText.length + (bodyHtml ? bodyHtml.length : 0),
        attachments.length > 0,
      ]
    );

    if (ins.rowCount === 0) {
      return res.json({ accepted: true, deduped: true });
    }

    const commId = ins.rows[0].id;

    for (const att of attachments) {
      await pool.query(
        `INSERT INTO email_attachments (comm_id, filename, content_type, size_bytes, storage_key, is_inline)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          commId,
          att.filename || att.name || 'attachment',
          att.content_type || att.mimeType || null,
          att.size || null,
          att.storage_key || `pending/${businessId}/${commId}/${att.filename || 'a'}`,
          !!att.is_inline,
        ]
      );
    }

    return res.json({
      accepted: true,
      comm_id: commId,
      lead_id: leadId,
      business_id: businessId,
      source,
    });
  } catch (err) {
    console.error('POST /inbox/webhook/n8n', err);
    res.status(500).json({ error: err.message });
  }
});

function extractEmail(s) {
  if (!s) return '';
  const m = String(s).match(/<([^>]+)>/);
  if (m) return m[1];
  const m2 = String(s).match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m2 ? m2[0] : '';
}

function extractName(s) {
  if (!s) return '';
  return String(s).replace(/<[^>]+>/, '').replace(/"/g, '').trim();
}

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
