#!/usr/bin/env node
/**
 * Auto-discover new Ziarem apps by scanning the shared Supabase Postgres
 * for table prefixes (`<prefix>_<rest>`) and append any unknown prefix to
 * `hermes/apps.yaml`.
 *
 * Existing entries are never modified. New entries get sensible defaults
 * and a `# TODO:` marker so a human can fill in the vertical / notes.
 *
 * Run locally:
 *   PGHOST=... PGUSER=... PGPASSWORD=... PGDATABASE=... node scripts/discover-apps.cjs
 *
 * Run from CI:
 *   .github/workflows/hermes-sync.yml runs this weekly and opens a PR
 *   when new prefixes show up.
 *
 * Exits 0 with no output when nothing changed (so CI can no-op).
 */

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT || '5432', 10),
  database: process.env.PGDATABASE || 'postgres',
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000,
});

const APPS_YAML = path.join(__dirname, '..', 'hermes', 'apps.yaml');
const MIN_TABLES_FOR_NEW_APP = 2; // ignore one-off `<word>_*` tables

// Prefixes we never want to register (system / shared / non-app tables).
const IGNORED_PREFIXES = new Set([
  'pg', 'auth', 'storage', 'realtime', 'extensions',
  'lead', 'leads', 'profile', 'profiles', 'user', 'users',
  'app', 'audit', 'campaign', 'campaigns', 'message', 'messages',
  'document', 'documents', 'email', 'emails', 'commission', 'commissions',
  'consent', 'transaction', 'transactions', 'webhook', 'webhooks',
  'integration', 'verification', 'wa', 'video',
  'newsletter', 'channel', 'product', 'products', 'pricing',
  'partners', 'policies', 'orders', 'partner', 'order',
  'flyer', 'review', 'reviews', 'inspections', 'inspection',
  'health', // health_* is registered explicitly; keep manual control
]);

async function listPublicTables() {
  const r = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  return r.rows.map((row) => row.table_name);
}

function extractPrefix(tableName) {
  const idx = tableName.indexOf('_');
  if (idx <= 0) return null;
  return tableName.slice(0, idx);
}

function loadKnownPrefixes() {
  const raw = fs.readFileSync(APPS_YAML, 'utf8');
  const known = new Set();
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*prefix:\s*"([^"]+)"/);
    if (m) known.add(m[1]);
  }
  return { raw, known };
}

function appendBlock(rawYaml, slug, prefix, tableCount) {
  const block = `
${slug}:
  name: "${slug.toUpperCase()} (auto-discovered, please edit)"
  prefix: "${prefix}"
  vertical: "other"
  anchor: false
  notes: "Auto-discovered by scripts/discover-apps.cjs (${tableCount} tables under ${prefix}_*). TODO: set vertical + notes."
`;
  return rawYaml.replace(/\s*$/, '') + '\n' + block;
}

(async () => {
  const tables = await listPublicTables();
  const { raw, known } = loadKnownPrefixes();

  const counts = new Map();
  for (const t of tables) {
    const p = extractPrefix(t);
    if (!p) continue;
    if (IGNORED_PREFIXES.has(p)) continue;
    counts.set(p, (counts.get(p) || 0) + 1);
  }

  const newPrefixes = [];
  for (const [prefix, count] of counts) {
    if (count < MIN_TABLES_FOR_NEW_APP) continue;
    if (known.has(prefix)) continue;
    newPrefixes.push({ prefix, count });
  }

  newPrefixes.sort((a, b) => b.count - a.count);

  if (newPrefixes.length === 0) {
    console.log('No new app prefixes discovered.');
    await pool.end();
    return;
  }

  let updated = raw;
  for (const { prefix, count } of newPrefixes) {
    updated = appendBlock(updated, prefix, prefix, count);
    console.log(`+ ${prefix} (${count} tables)`);
  }

  fs.writeFileSync(APPS_YAML, updated);
  console.log(`\nWrote ${newPrefixes.length} new entries to ${APPS_YAML}`);
  await pool.end();
})().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
