#!/usr/bin/env node
/**
 * Seed business_emails with one row per Ziarem business (placeholder SMTP/IMAP).
 * Run once after migrations. Update rows with real credentials for live email.
 *
 * Usage: node scripts/seed_business_emails.js
 */

const { pool } = require('../src/db');
const { BUSINESSES } = require('../config/businesses');

const PLACEHOLDER = {
  email_user: 'configure@yourdomain.com',
  email_pass: 'REPLACE_WITH_REAL_PASSWORD',
  smtp_host: 'smtp.example.com',
  imap_host: 'imap.example.com',
};

async function run() {
  for (const b of BUSINESSES) {
    const name = b.name.length > 100 ? b.name.slice(0, 100) : b.name;
    await pool.query(
      `INSERT INTO business_emails (business_name, email_user, email_pass, smtp_host, imap_host)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (business_name) DO NOTHING`,
      [name, PLACEHOLDER.email_user, PLACEHOLDER.email_pass, PLACEHOLDER.smtp_host, PLACEHOLDER.imap_host]
    );
    console.log('  ', name);
  }
  console.log(`Done. ${BUSINESSES.length} business(es) in business_emails. Update rows with real SMTP/IMAP to use inbox.`);
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
