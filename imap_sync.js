#!/usr/bin/env node
/**
 * Ziarem Inbox Sync – fetch UNSEEN from all business_emails via IMAP, match from-address to leads, save to communications, mark read.
 * Usage: node imap_sync.js
 */

const Imap = require('imap-simple');
const { pool } = require('./src/db');
const { simpleParser } = require('mailparser');

const DEFAULT_IMAP_OPTS = { port: 993, tls: true };

async function getBusinessEmails() {
  const r = await pool.query('SELECT id, business_name, email_user, email_pass, imap_host FROM business_emails');
  return r.rows;
}

async function findLeadIdByEmail(email) {
  if (!email || !email.trim()) return null;
  const normalized = email.trim().toLowerCase();
  const r = await pool.query(
    'SELECT autoId_ui FROM leads WHERE LOWER(TRIM(email_addr)) = $1 LIMIT 1',
    [normalized]
  );
  return r.rows[0]?.autoId_ui ?? null;
}

async function saveInbound(leadId, businessId, subject, bodyText, bodyHtml, sentAt) {
  await pool.query(
    `INSERT INTO communications (lead_id, direction, subject, body_text, body_html, sent_at, business_id)
     VALUES ($1, 'INBOUND', $2, $3, $4, $5, $6)`,
    [leadId, subject || '', bodyText || '', bodyHtml || null, sentAt, businessId]
  );
}

async function syncBusiness(config) {
  const { id: businessId, business_name, email_user, email_pass, imap_host } = config;
  const imapConfig = {
    ...DEFAULT_IMAP_OPTS,
    user: email_user,
    password: email_pass,
    host: imap_host,
  };

  let connection;
  try {
    connection = await Imap.connect(imapConfig);
  } catch (err) {
    console.error(`[${business_name}] IMAP connect failed:`, err.message);
    return { business: business_name, fetched: 0, saved: 0, errors: 1 };
  }

  let fetched = 0;
  let saved = 0;
  try {
    await connection.openMailbox('INBOX');
    const results = await connection.search(['UNSEEN'], { bodies: [''], markSeen: false });
    fetched = results.length;
    const seenUids = [];
    for (const res of results) {
      const uid = res.attributes.uid;
      const part = res.parts?.find((p) => p.which === '');
      let source = part?.body;
      if (source == null) continue;
      if (typeof source === 'string') source = Buffer.from(source, 'binary');
      let subject = '';
      let bodyText = '';
      let bodyHtml = null;
      let fromAddr = '';
      let date = new Date();
      try {
        const parsed = await simpleParser(source);
        subject = parsed.subject || '';
        bodyText = parsed.text || '';
        bodyHtml = parsed.html || null;
        fromAddr = (parsed.from?.value?.[0]?.address || parsed.from?.text || '').trim();
        if (parsed.date) date = parsed.date;
      } catch (e) {
        console.error(`[${business_name}] Parse error uid ${uid}:`, e.message);
        continue;
      }
      const leadId = await findLeadIdByEmail(fromAddr);
      await saveInbound(leadId, businessId, subject, bodyText, bodyHtml, date);
      saved++;
      seenUids.push(uid);
    }
    if (seenUids.length > 0) {
      connection.addFlags(seenUids, ['\\Seen']);
    }
  } catch (err) {
    console.error(`[${business_name}] Sync error:`, err.message);
  } finally {
    try {
      connection.end();
    } catch (_) {}
  }
  return { business: business_name, fetched, saved, errors: 0 };
}

async function run() {
  const businesses = await getBusinessEmails();
  if (businesses.length === 0) {
    console.log('No business_emails configured.');
    await pool.end();
    return;
  }
  console.log(`Syncing ${businesses.length} business inbox(es)...`);
  for (const config of businesses) {
    const result = await syncBusiness(config);
    console.log(`  ${result.business}: ${result.fetched} UNSEEN, ${result.saved} saved (matched to lead)`);
  }
  await pool.end();
  console.log('Done.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
