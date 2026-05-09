/**
 * Lead matching for inbound emails.
 * 1. Try exact email match against leads.email_addr (case-insensitive).
 * 2. Try AI hint email/phone match.
 * 3. Try fuzzy name + zip match (last resort, only if confidence high).
 *
 * On match: link communications.lead_id, insert crm_activities row,
 * insert lead_score_events row (score_delta from AI triage), tag lead with business.
 *
 * On no match: leave lead_id NULL but keep ai_lead_match_hints for manual review.
 */

const { pool } = require('./db');

async function matchExactEmail(email) {
  if (!email) return null;
  const r = await pool.query(
    `SELECT autoId_ui FROM leads WHERE LOWER(TRIM(email_addr)) = LOWER(TRIM($1)) LIMIT 1`,
    [email]
  );
  return r.rows[0]?.autoid_ui ?? r.rows[0]?.autoId_ui ?? null;
}

async function matchExactPhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 10) return null;
  const tail = digits.slice(-10);
  const r = await pool.query(
    `SELECT autoId_ui FROM leads
      WHERE regexp_replace(COALESCE(phone_nbr, ''), '[^0-9]', '', 'g') LIKE '%' || $1
         OR regexp_replace(COALESCE(mobile_phone, ''), '[^0-9]', '', 'g') LIKE '%' || $1
         OR regexp_replace(COALESCE(mobile_ui, ''),    '[^0-9]', '', 'g') LIKE '%' || $1
      LIMIT 1`,
    [tail]
  );
  return r.rows[0]?.autoid_ui ?? r.rows[0]?.autoId_ui ?? null;
}

async function matchFuzzyName(name, zip) {
  if (!name || !zip) return null;
  const r = await pool.query(
    `SELECT autoId_ui, similarity(LOWER(first_name || ' ' || last_name), LOWER($1)) AS sim
       FROM leads
      WHERE zip_code = $2
        AND first_name IS NOT NULL AND last_name IS NOT NULL
        AND similarity(LOWER(first_name || ' ' || last_name), LOWER($1)) > 0.6
   ORDER BY sim DESC LIMIT 1`,
    [name, zip]
  );
  return r.rows[0]?.autoid_ui ?? r.rows[0]?.autoId_ui ?? null;
}

async function findOrSuggestLead(comm) {
  const fromAddr = comm.from_addr;
  const hints = comm.ai_lead_match_hints || {};

  // 1. Exact match on the actual sender email
  let leadId = await matchExactEmail(fromAddr);
  if (leadId) return { leadId, confidence: 100, method: 'exact_from' };

  // 2. AI-extracted email hint (e.g. body contains "my email is foo@bar.com")
  if (hints.email && hints.email.toLowerCase() !== (fromAddr || '').toLowerCase()) {
    leadId = await matchExactEmail(hints.email);
    if (leadId) return { leadId, confidence: 90, method: 'exact_hint_email' };
  }

  // 3. Phone hint
  if (hints.phone) {
    leadId = await matchExactPhone(hints.phone);
    if (leadId) return { leadId, confidence: 80, method: 'exact_hint_phone' };
  }

  // 4. Name + ZIP fuzzy
  if (hints.name && hints.address) {
    const zipMatch = String(hints.address).match(/\b(\d{5})\b/);
    if (zipMatch) {
      leadId = await matchFuzzyName(hints.name, zipMatch[1]);
      if (leadId) return { leadId, confidence: 60, method: 'fuzzy_name_zip' };
    }
  }

  return { leadId: null, confidence: 0, method: 'none' };
}

async function applyMatchAndUpdateCRM(commId) {
  const { rows } = await pool.query(
    `SELECT id, business_id, from_addr, from_name, subject, body_text, sent_at,
            ai_summary, ai_intent, ai_priority, ai_tags, ai_business_tag,
            ai_lead_match_hints, ai_score_delta, lead_id
       FROM communications WHERE id = $1`,
    [commId]
  );
  const c = rows[0];
  if (!c) throw new Error(`comm not found: ${commId}`);

  if (c.lead_id) {
    // Already matched (imap_sync.js may have done it on insert) — still log activity + score event
    await logActivity(c, c.lead_id);
    return { leadId: c.lead_id, alreadyMatched: true };
  }

  const { leadId, confidence, method } = await findOrSuggestLead(c);
  await pool.query(
    `UPDATE communications SET lead_id = $1, ai_lead_match_confidence = $2 WHERE id = $3`,
    [leadId, confidence, commId]
  );

  if (leadId) {
    await logActivity(c, leadId);
    return { leadId, confidence, method };
  }
  return { leadId: null, confidence: 0, method };
}

async function logActivity(comm, leadId) {
  await pool.query(
    `INSERT INTO crm_activities (lead_id, business_id, comm_id, type, subject, body, ai_insight)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      leadId,
      comm.business_id,
      comm.id,
      'email_in',
      comm.subject?.slice(0, 500) || null,
      comm.body_text?.slice(0, 8000) || null,
      comm.ai_summary,
    ]
  );

  if (comm.ai_score_delta && comm.ai_score_delta !== 0) {
    await pool.query(
      `INSERT INTO lead_score_events (lead_id, event_type, score_delta, reason, ai_insight, comm_id, business_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        leadId,
        comm.ai_intent || 'email_in',
        comm.ai_score_delta,
        `Inbound email — intent=${comm.ai_intent}, priority=${comm.ai_priority}`,
        comm.ai_summary,
        comm.id,
        comm.business_id,
      ]
    );
  }

  // Tag the lead with the business that received the email (additive merge into ziarem_tags JSONB).
  if (comm.business_id) {
    await pool.query(
      `UPDATE leads
          SET ziarem_tags = COALESCE(ziarem_tags, '{}'::jsonb)
                          || jsonb_build_object(
                                COALESCE((SELECT business_tag FROM business_emails WHERE id = $2), 'unknown'),
                                jsonb_build_object('last_email_at', now(), 'comm_id', $3))
        WHERE autoId_ui = $1`,
      [leadId, comm.business_id, comm.id]
    );
  }
}

module.exports = { findOrSuggestLead, applyMatchAndUpdateCRM, matchExactEmail, matchExactPhone };
