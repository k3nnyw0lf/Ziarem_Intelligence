#!/usr/bin/env node
/**
 * Ziarem Inbox Sync — incremental (UNSEEN only).
 * For each ACTIVE business mailbox: fetch UNSEEN, parse, dedupe by Message-ID,
 * insert into communications with full headers + thread_key, mark seen.
 * Leaves ai_processed_at NULL so ai_worker.js picks each up.
 *
 * For historical fetch use imap_backfill.js.
 *
 * Usage: node imap_sync.js
 */

const Imap = require('imap-simple');
const { pool } = require('./src/db');
const { simpleParser } = require('mailparser');

const DEFAULT_IMAP_OPTS = { tls: true, authTimeout: 30000 };

async function getActiveBusinesses() {
  const r = await pool.query(
    `SELECT id, business_name, business_tag, email_user, email_pass, imap_host, imap_port
       FROM business_emails
      WHERE is_active = TRUE`
  );
  return r.rows;
}

function buildThreadKey({ messageId, inReplyTo, references, subject }) {
  if (inReplyTo) return inReplyTo;
  if (references && references.length > 0) return references[0];
  if (messageId) return messageId;
  return 'subj:' + (subject || '').replace(/^(re:|fwd:|fw:)\s*/gi, '').trim().toLowerCase().slice(0, 120);
}

async function findLeadIdByEmail(email) {
  if (!email || !email.trim()) return null;
  const r = await pool.query(
    `SELECT autoId_ui FROM leads WHERE LOWER(TRIM(email_addr)) = LOWER(TRIM($1)) LIMIT 1`,
    [email]
  );
  return r.rows[0]?.autoid_ui ?? r.rows[0]?.autoId_ui ?? null;
}

async function saveInbound(parsed, businessId, uid, source) {
  const messageId = (parsed.messageId || '').replace(/[<>]/g, '') || null;
  const refs = (parsed.references ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references]) : [])
                .map((r) => String(r).replace(/[<>]/g, ''));
  const inReplyTo = parsed.inReplyTo ? String(parsed.inReplyTo).replace(/[<>]/g, '') : null;
  const subject = parsed.subject || '';
  const bodyText = parsed.text || '';
  const bodyHtml = parsed.html || null;
  const fromAddr = (parsed.from?.value?.[0]?.address || '').toLowerCase().trim();
  const fromName = parsed.from?.value?.[0]?.name || null;
  const toAddrs = (parsed.to?.value || []).map((t) => t.address).filter(Boolean);
  const ccAddrs = (parsed.cc?.value || []).map((t) => t.address).filter(Boolean);
  const sentAt = parsed.date || new Date();
  const threadKey = buildThreadKey({ messageId, inReplyTo, references: refs, subject });

  const leadId = await findLeadIdByEmail(fromAddr);

  const ins = await pool.query(
    `INSERT INTO communications
       (lead_id, direction, subject, body_text, body_html, sent_at, business_id,
        rfc822_message_id, in_reply_to, message_refs, thread_key,
        from_addr, from_name, to_addrs, cc_addrs, imap_uid,
        size_bytes, has_attachments)
     VALUES ($1, 'INBOUND', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     ON CONFLICT (business_id, rfc822_message_id) WHERE rfc822_message_id IS NOT NULL DO NOTHING
     ON CONFLICT (business_id, imap_uid)         WHERE imap_uid IS NOT NULL          DO NOTHING
     RETURNING id`,
    [
      leadId, subject, bodyText, bodyHtml, sentAt, businessId,
      messageId, inReplyTo, refs, threadKey,
      fromAddr || null, fromName, toAddrs, ccAddrs, uid,
      source?.length || null, (parsed.attachments || []).length > 0,
    ]
  );

  if (ins.rowCount === 0) return { skipped: true };
  const commId = ins.rows[0].id;

  for (const att of parsed.attachments || []) {
    await pool.query(
      `INSERT INTO email_attachments (comm_id, filename, content_type, size_bytes, sha256, storage_key, is_inline)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        commId,
        att.filename || 'attachment',
        att.contentType || null,
        att.size || null,
        null,
        `pending/${businessId}/${commId}/${att.filename || 'a'}`,
        !!att.related,
      ]
    );
  }

  return { commId, leadId };
}

async function syncBusiness(b) {
  const imapConfig = {
    ...DEFAULT_IMAP_OPTS,
    user: b.email_user,
    password: b.email_pass,
    host: b.imap_host,
    port: b.imap_port || 993,
  };

  let connection;
  try {
    connection = await Imap.connect(imapConfig);
  } catch (err) {
    await pool.query(`UPDATE business_emails SET last_sync_error = $2 WHERE id = $1`, [b.id, String(err.message).slice(0, 500)]);
    console.error(`[${b.business_name}] IMAP connect failed:`, err.message);
    return { business: b.business_name, fetched: 0, saved: 0, errors: 1 };
  }

  let fetched = 0, saved = 0, skipped = 0;
  try {
    await connection.openBox('INBOX');
    const results = await connection.search(['UNSEEN'], { bodies: [''], markSeen: false });
    fetched = results.length;
    const seenUids = [];

    for (const res of results) {
      const uid = res.attributes.uid;
      const part = res.parts?.find((p) => p.which === '');
      let source = part?.body;
      if (source == null) continue;
      if (typeof source === 'string') source = Buffer.from(source, 'binary');

      try {
        const parsed = await simpleParser(source);
        const r = await saveInbound(parsed, b.id, uid, source);
        if (r.skipped) skipped++; else saved++;
        seenUids.push(uid);
      } catch (e) {
        console.error(`[${b.business_name}] parse error uid ${uid}:`, e.message);
      }
    }
    if (seenUids.length > 0) connection.addFlags(seenUids, ['\\Seen']);
    await pool.query(`UPDATE business_emails SET last_imap_sync_at = now(), last_sync_error = NULL WHERE id = $1`, [b.id]);
  } catch (err) {
    await pool.query(`UPDATE business_emails SET last_sync_error = $2 WHERE id = $1`, [b.id, String(err.message).slice(0, 500)]);
    console.error(`[${b.business_name}] sync error:`, err.message);
  } finally {
    try { connection.end(); } catch (_) {}
  }
  return { business: b.business_name, fetched, saved, skipped };
}

async function run() {
  const businesses = await getActiveBusinesses();
  if (businesses.length === 0) {
    console.log('No active businesses. Set business_emails.is_active = TRUE for the ones to sync.');
    await pool.end();
    return;
  }
  console.log(`Syncing ${businesses.length} active inbox(es)...`);
  for (const b of businesses) {
    const r = await syncBusiness(b);
    console.log(`  ${r.business}: fetched=${r.fetched} saved=${r.saved} skipped=${r.skipped || 0}`);
  }
  await pool.end();
  console.log('Done. Run `node ai_worker.js` to triage saved messages.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
