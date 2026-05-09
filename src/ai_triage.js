/**
 * Ziarem AI Triage
 * Given a communications row, classifies it via the LLM router (free tier first).
 * Writes ai_summary, ai_intent, ai_priority, ai_tags, ai_extracted, ai_business_tag,
 * ai_lead_match_hints, ai_score_delta back to the row.
 *
 * Uses prompt caching when the chosen provider supports it (Anthropic).
 */

const { pool } = require('./db');
const { llm } = require('./llm/router');

const SYSTEM_PROMPT = `You are the triage AI for Ziarem — a CRM serving Kenneth Wolf's businesses.

Active businesses for this triage:
- Re4lty: real estate brokerage (FL). Buyer leads, listing inquiries, agent referrals.
- DOS Mortgage / Laenan: mortgage origination. Loan applications, rate quotes, doc requests, lender comms.
- Wolf Surety: surety bonds + insurance for contractors / trades.
- Wolf Insurance: liability + high-risk property insurance.

For each email, output STRICT JSON:
{
  "summary": "1-2 concrete sentences",
  "intent": one of [lead_inquiry, doc_request, rate_quote, status_update, scheduling, complaint, vendor, internal, marketing, transaction, legal, referral, other],
  "priority": 0-100 integer (100 = drop everything),
  "tags": string[],
  "business_tag": one of [re4lty, dosmortgage, laenan, wolfsurety, wolfinsurance, other] | null,
  "client_match_hints": { "email"?: string, "phone"?: string, "name"?: string, "address"?: string },
  "extracted": {
    "amounts":   number[],
    "dates":     string[] (ISO),
    "asks":      string[],
    "lender_mentions": string[],
    "doc_requests":   string[],
    "property_address": string | null,
    "loan_purpose": "purchase" | "refi" | "cash_out" | "construction" | null,
    "fico_band":  "<600" | "600-660" | "660-700" | "700-740" | "740+" | null
  },
  "attachment_classifications": [{
    "filename": string,
    "classification": one of [paystub, w2, 1099, tax_return, bank_statement, id, license, lease,
                              mortgage_statement, closing_doc, contract, insurance_policy,
                              rate_sheet, legal, medical, other],
    "is_sensitive": boolean
  }],
  "score_delta": -10 to 10 (signed integer; positive = lead is warmer)
}

Rules:
- Output JSON ONLY. No prose, no markdown fences.
- Sensitive = PII / SSN / account# / income figures / IDs / medical records → is_sensitive=true.
- Use sender domain to seed business_tag (laenan.com → laenan, dosmortgage.com → dosmortgage, re4lty.com → re4lty).
- score_delta: +10 for hot lead inquiry with budget/timeline; -5 for unsubscribe / complaint; 0 for marketing newsletters.
- Be conservative on priority: 80+ only when there's an explicit deadline within 24h.`;

function buildUserPrompt({ subject, fromAddr, fromName, toAddrs, body, attachments, businessName, businessTag, sentAt }) {
  return JSON.stringify({
    business: { name: businessName, tag: businessTag },
    received_at: sentAt,
    subject: subject || '',
    from: { name: fromName || null, email: fromAddr || null },
    to: toAddrs || [],
    body: (body || '').slice(0, 8000),
    attachments: (attachments || []).map((a) => a.filename),
  }, null, 2);
}

const VALID_INTENTS = new Set(['lead_inquiry','doc_request','rate_quote','status_update','scheduling','complaint','vendor','internal','marketing','transaction','legal','referral','other']);
const VALID_BUSINESS_TAGS = new Set(['re4lty','dosmortgage','laenan','wolfsurety','wolfinsurance','other']);

function normalize(t) {
  if (!t || typeof t !== 'object') throw new Error('triage: not an object');
  const out = {
    summary: String(t.summary || '').slice(0, 1000),
    intent: VALID_INTENTS.has(t.intent) ? t.intent : 'other',
    priority: Math.max(0, Math.min(100, Number(t.priority) || 0)),
    tags: Array.isArray(t.tags) ? t.tags.map(String).slice(0, 30) : [],
    business_tag: VALID_BUSINESS_TAGS.has(t.business_tag) ? t.business_tag : null,
    client_match_hints: t.client_match_hints && typeof t.client_match_hints === 'object' ? t.client_match_hints : {},
    extracted: t.extracted && typeof t.extracted === 'object' ? t.extracted : { amounts: [], dates: [], asks: [], lender_mentions: [], doc_requests: [] },
    attachment_classifications: Array.isArray(t.attachment_classifications) ? t.attachment_classifications : [],
    score_delta: Math.max(-10, Math.min(10, Number(t.score_delta) || 0)),
  };
  return out;
}

async function triageMessage({ comm_id }) {
  const { rows } = await pool.query(
    `SELECT c.id, c.subject, c.body_text, c.from_addr, c.from_name, c.to_addrs, c.sent_at,
            be.business_name, be.business_tag
       FROM communications c
       LEFT JOIN business_emails be ON be.id = c.business_id
      WHERE c.id = $1`,
    [comm_id]
  );
  const m = rows[0];
  if (!m) throw new Error(`comm not found: ${comm_id}`);

  const { rows: atts } = await pool.query(
    'SELECT filename, content_type, size_bytes FROM email_attachments WHERE comm_id = $1',
    [comm_id]
  );

  const userPrompt = buildUserPrompt({
    subject: m.subject,
    fromAddr: m.from_addr,
    fromName: m.from_name,
    toAddrs: m.to_addrs,
    body: m.body_text,
    attachments: atts,
    businessName: m.business_name,
    businessTag: m.business_tag,
    sentAt: m.sent_at,
  });

  const result = await llm.json({
    task: 'triage',
    system: SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: 1024,
    comm_id,
  });

  const triage = normalize(result.json);

  await pool.query(
    `UPDATE communications
        SET ai_processed_at = now(),
            ai_summary = $2,
            ai_intent = $3,
            ai_priority = $4,
            ai_tags = $5,
            ai_extracted = $6,
            ai_business_tag = $7,
            ai_lead_match_hints = $8,
            ai_score_delta = $9,
            ai_error = NULL
      WHERE id = $1`,
    [
      comm_id,
      triage.summary,
      triage.intent,
      triage.priority,
      triage.tags,
      JSON.stringify({ ...triage.extracted, attachments: triage.attachment_classifications }),
      triage.business_tag,
      JSON.stringify(triage.client_match_hints),
      triage.score_delta,
    ]
  );

  // Apply attachment sensitivity flags
  for (const ac of triage.attachment_classifications) {
    if (!ac?.filename) continue;
    await pool.query(
      `UPDATE email_attachments SET ai_classified = $1, is_sensitive = $2
        WHERE comm_id = $3 AND filename = $4`,
      [ac.classification || 'other', !!ac.is_sensitive, comm_id, ac.filename]
    );
  }

  return { comm_id, provider: result.provider, model: result.model, cost: result.est_cost_usd, triage };
}

async function markFailed(comm_id, err) {
  await pool.query(
    `UPDATE communications SET ai_error = $2, ai_attempts = ai_attempts + 1 WHERE id = $1`,
    [comm_id, String(err.message || err).slice(0, 500)]
  );
}

module.exports = { triageMessage, markFailed, SYSTEM_PROMPT };
