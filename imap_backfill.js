#!/usr/bin/env node
/**
 * Ziarem Inbox Backfill — historical fetch.
 * Pulls ALL messages (not just UNSEEN) from each active business mailbox in 30-day chunks,
 * starting from the configured backfill_through_date back to a target start date.
 *
 * Idempotent: skips messages already inserted (uniq on (business_id, rfc822_message_id)).
 * Marks ai_processed_at = NULL so ai_worker.js triages them next.
 *
 * Usage:
 *   node imap_backfill.js                    # back to 5 years for all active businesses
 *   node imap_backfill.js --years 2          # back 2 years
 *   node imap_backfill.js --business 3       # only business_emails.id = 3
 */

const Imap = require('imap-simple');
const { simpleParser } = require('mailparser');
const { pool } = require('./src/db');

const args = parseArgs(process.argv.slice(2));
const YEARS = Number(args.years || 5);
const TARGET_BUSINESS_ID = args.business ? Number(args.business) : null;
const CHUNK_DAYS = 30;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
    }
  }
  return out;
}

function imapDate(d) {
  // IMAP search date format: 1-Jan-2024
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

function buildThreadKey({ messageId, inReplyTo, references, subject }) {
  if (inReplyTo) return inReplyTo;
  if (references && references.length > 0) return references[0];
  if (messageId) return messageId;
  // last-resort: normalized subject
  return 'subj:' + (subject || '').replace(/^(re:|fwd:|fw:)\s*/gi, '').trim().toLowerCase().slice(0, 120);
}

async function getActiveBusinesses() {
  const sql = TARGET_BUSINESS_ID
    ? 'SELECT id, business_name, business_tag, email_user, email_pass, imap_host, imap_port, backfill_through_date FROM business_emails WHERE id = $1'
    : 'SELECT id, business_name, business_tag, email_user, email_pass, imap_host, imap_port, backfill_through_date FROM business_emails WHERE is_active = TRUE';
  const r = await pool.query(sql, TARGET_BUSINESS_ID ? [TARGET_BUSINESS_ID] : []);
  return r.rows;
}

async function backfillBusiness(b) {
  const since = new Date();
  since.setFullYear(since.getFullYear() - YEARS);
  const through = b.backfill_through_date ? new Date(b.backfill_through_date) : new Date();

  console.log(`[${b.business_name}] backfill ${imapDate(since)} → ${imapDate(through)}`);

  await pool.query(`UPDATE business_emails SET backfill_started_at = now() WHERE id = $1`, [b.id]);

  let connection;
  try {
    connection = await Imap.connect({
      user: b.email_user,
      password: b.email_pass,
      host: b.imap_host,
      port: b.imap_port || 993,
      tls: true,
      authTimeout: 30000,
    });
    await connection.openBox('INBOX');

    let totalSaved = 0;
    let totalSkipped = 0;

    // Walk in 30-day chunks newest → oldest
    let cursor = new Date(through);
    while (cursor > since) {
      const chunkStart = new Date(cursor);
      chunkStart.setDate(chunkStart.getDate() - CHUNK_DAYS);
      const lower = chunkStart < since ? since : chunkStart;

      const criteria = [['SINCE', imapDate(lower)], ['BEFORE', imapDate(cursor)]];
      let results;
      try {
        results = await connection.search(criteria, { bodies: [''], markSeen: false });
      } catch (err) {
        console.error(`[${b.business_name}] chunk ${imapDate(lower)}-${imapDate(cursor)} search error:`, err.message);
        cursor = chunkStart;
        continue;
      }

      console.log(`  chunk ${imapDate(lower)}-${imapDate(cursor)}: ${results.length} messages`);

      for (const res of results) {
        const uid = res.attributes.uid;
        const part = res.parts?.find((p) => p.which === '');
        let source = part?.body;
        if (!source) continue;
        if (typeof source === 'string') source = Buffer.from(source, 'binary');

        try {
          const parsed = await simpleParser(source);
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

          // Match lead by sender email (cheap pre-pass; AI will refine later if needed).
          const lr = fromAddr ? await pool.query(
            `SELECT autoId_ui FROM leads WHERE LOWER(TRIM(email_addr)) = $1 LIMIT 1`,
            [fromAddr]
          ) : { rows: [] };
          const leadId = lr.rows[0]?.autoId_ui ?? lr.rows[0]?.autoid_ui ?? null;

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
              leadId, subject || '', bodyText || '', bodyHtml, sentAt, b.id,
              messageId, inReplyTo, refs, threadKey,
              fromAddr || null, fromName, toAddrs, ccAddrs, uid,
              source.length, (parsed.attachments || []).length > 0,
            ]
          );

          if (ins.rowCount === 0) {
            totalSkipped++;
            continue;
          }
          const commId = ins.rows[0].id;

          // Insert attachment metadata (no blob upload here — backfill stays light;
          // the live sync path or a separate job uploads .eml + attachments to storage).
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
                `pending/${b.id}/${commId}/${att.filename || 'a'}`,
                !!att.related,
              ]
            );
          }

          totalSaved++;
        } catch (e) {
          console.error(`  parse error uid ${uid}:`, e.message);
        }
      }
      cursor = chunkStart;
    }

    await pool.query(
      `UPDATE business_emails SET backfill_completed_at = now(), backfill_through_date = $2 WHERE id = $1`,
      [b.id, since.toISOString().slice(0, 10)]
    );

    console.log(`[${b.business_name}] DONE: saved=${totalSaved} skipped=${totalSkipped}`);
    return { business: b.business_name, saved: totalSaved, skipped: totalSkipped };
  } catch (err) {
    await pool.query(`UPDATE business_emails SET last_sync_error = $2 WHERE id = $1`, [b.id, String(err.message).slice(0, 500)]);
    console.error(`[${b.business_name}] backfill failed:`, err.message);
    return { business: b.business_name, error: err.message };
  } finally {
    try { connection?.end(); } catch (_) {}
  }
}

async function run() {
  const businesses = await getActiveBusinesses();
  if (businesses.length === 0) {
    console.error('No active businesses. Set business_emails.is_active = TRUE for the ones you want to backfill.');
    process.exit(1);
  }
  console.log(`Backfilling ${businesses.length} business(es), ${YEARS} year(s) back`);
  const results = [];
  for (const b of businesses) {
    results.push(await backfillBusiness(b));
  }
  console.log('\n=== Backfill summary ===');
  for (const r of results) console.log(' ', r);
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
