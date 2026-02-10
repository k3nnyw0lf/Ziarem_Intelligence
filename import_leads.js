#!/usr/bin/env node
/**
 * Import leads from CSV or Excel into the leads table in batches of 1,000.
 * Automatically detects Cole Data Dictionary (FA + CP) format and maps columns.
 * Usage: node import_leads.js <path-to-leads.csv|.xlsx>
 * Requires .env with PGHOST, PGUSER, PGPASSWORD, PGDATABASE (and PGSSLMODE=require for Hostinger).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse } = require('csv-parse');
const XLSX = require('xlsx');
const { pool } = require('./src/db');
const { isColeFormatByHeaders, isColeFormatByFilename } = require('./lib/format-detector');
const { mapColeRow } = require('./lib/cole-mapper');

const BATCH_SIZE = 1000;
const ALLOWED_TAGS = new Set(['Lyco', 'Wolf', 'Dispute']);

function normalizeKey(str) {
  if (typeof str !== 'string') return '';
  return str.trim().toLowerCase().replace(/\s+/g, '_');
}

function parseTags(value) {
  if (value == null || value === '') return [];
  const raw = String(value).split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
  return raw.filter((t) => ALLOWED_TAGS.has(t));
}

function parseScore(value) {
  if (value == null || value === '') return 0;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? 0 : Math.max(0, Math.min(100, n));
}

/** Generic CSV row -> lead row (no Cole columns) */
function parseGenericRow(record) {
  const key = (k) => record[Object.keys(record).find((r) => normalizeKey(r) === k)];
  const str = (k, def = '') => {
    const v = key(k);
    return v != null && v !== '' ? String(v).trim().slice(0, 255) : def;
  };
  const firstName = str('first_name') || str('firstname');
  const lastName = str('last_name') || str('lastname');
  const email = str('email');
  if (!email) return null;

  const idRaw = key('id');
  const id = idRaw && /^[0-9a-f-]{36}$/i.test(String(idRaw).trim()) ? String(idRaw).trim() : null;
  const phone = str('phone') || str('phone_number') || null;
  const businessTags = parseTags(key('business_tags') ?? key('business_tags'));
  const leadScore = parseScore(key('lead_score') ?? key('leadscore'));
  const createdAtRaw = key('created_at') ?? key('createdat');
  const createdAt = createdAtRaw && !Number.isNaN(Date.parse(createdAtRaw)) ? new Date(createdAtRaw).toISOString() : null;

  return {
    id,
    first_name: firstName || 'Unknown',
    last_name: lastName || 'Unknown',
    email,
    phone: phone || null,
    mobile_phone: null,
    business_tags: businessTags,
    lead_score: leadScore,
    created_at: createdAt,
    source: null,
    source_id: null,
    address_1: null,
    city: null,
    state: null,
    zip_code: null,
  };
}

const BASE_COLS = ['id', 'first_name', 'last_name', 'email', 'phone', 'business_tags', 'lead_score', 'created_at'];
const COLE_EXTRA_COLS = ['source', 'source_id', 'address_1', 'city', 'state', 'zip_code', 'mobile_phone'];

// Cole: partial unique index (source, source_id) — ON CONFLICT must repeat the index WHERE
async function insertBatchCole(rows) {
  if (rows.length === 0) return;
  const cols = [...BASE_COLS, ...COLE_EXTRA_COLS];
  const placeholders = [];
  const values = [];
  let paramIndex = 1;
  for (const row of rows) {
    placeholders.push(`(${cols.map(() => `$${paramIndex++}`).join(', ')})`);
    values.push(
      row.id,
      row.first_name,
      row.last_name,
      row.email,
      row.phone,
      row.business_tags?.length ? row.business_tags : null,
      row.lead_score,
      row.created_at ?? new Date().toISOString(),
      row.source,
      row.source_id,
      row.address_1,
      row.city,
      row.state,
      row.zip_code,
      row.mobile_phone
    );
  }
  await pool.query(
    `INSERT INTO leads (${cols.join(', ')}) VALUES ${placeholders.join(', ')}
     ON CONFLICT (source, source_id) WHERE source IS NOT NULL AND source_id IS NOT NULL DO NOTHING`,
    values
  );
}

async function insertBatchGeneric(rows) {
  if (rows.length === 0) return;
  const cols = BASE_COLS;
  const placeholders = [];
  const values = [];
  let paramIndex = 1;
  for (const row of rows) {
    placeholders.push(`(${cols.map(() => `$${paramIndex++}`).join(', ')})`);
    values.push(
      row.id,
      row.first_name,
      row.last_name,
      row.email,
      row.phone,
      row.business_tags?.length ? row.business_tags : null,
      row.lead_score,
      row.created_at ?? new Date().toISOString()
    );
  }
  await pool.query(
    `INSERT INTO leads (${cols.join(', ')}) VALUES ${placeholders.join(', ')}
     ON CONFLICT (id) DO NOTHING`,
    values
  );
}

async function runCsvImport(resolved, isCole) {
  let batch = [];
  let totalInserted = 0;
  let totalSkipped = 0;
  let batchCount = 0;
  const insertBatchFn = isCole ? insertBatchCole : insertBatchGeneric;

  return new Promise((resolve, reject) => {
    const parser = fs.createReadStream(resolved).pipe(
      parse({ columns: true, skip_empty_lines: true, trim: true, relax_column_count: true })
    );

    parser.on('data', (record) => {
      const row = isCole ? mapColeRow(record) : parseGenericRow(record);
      if (!row) {
        totalSkipped++;
        return;
      }
      if (!row.id) row.id = crypto.randomUUID();
      batch.push(row);
      if (batch.length >= BATCH_SIZE) {
        parser.pause();
        insertBatchFn(batch)
          .then(() => {
            batchCount++;
            totalInserted += batch.length;
            process.stderr.write(`\rBatch ${batchCount}: ${totalInserted} inserted, ${totalSkipped} skipped`);
            batch = [];
            parser.resume();
          })
          .catch(reject);
      }
    });

    parser.on('end', async () => {
      if (batch.length > 0) {
        try {
          await insertBatchFn(batch);
          batchCount++;
          totalInserted += batch.length;
        } catch (e) {
          return reject(e);
        }
      }
      resolve({ totalInserted, totalSkipped, batchCount });
    });

    parser.on('error', reject);
  });
}

async function runXlsxImport(resolved, isCole) {
  const workbook = XLSX.readFile(resolved, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  if (raw.length === 0) return { totalInserted: 0, totalSkipped: 0, batchCount: 0 };

  const headers = Object.keys(raw[0] || {});
  const detectedCole = isColeFormatByHeaders(headers);
  const useCole = isCole ?? detectedCole;

  let totalInserted = 0;
  let totalSkipped = 0;
  let batchCount = 0;
  const insertBatchFn = useCole ? insertBatchCole : insertBatchGeneric;

  let batch = [];
  for (let i = 0; i < raw.length; i++) {
    const record = raw[i];
    const row = useCole ? mapColeRow(record) : parseGenericRow(record);
    if (!row) {
      totalSkipped++;
      continue;
    }
    if (!row.id) row.id = crypto.randomUUID();
    batch.push(row);
    if (batch.length >= BATCH_SIZE) {
      await insertBatchFn(batch);
      batchCount++;
      totalInserted += batch.length;
      process.stderr.write(`\rBatch ${batchCount}: ${totalInserted} inserted, ${totalSkipped} skipped`);
      batch = [];
    }
  }
  if (batch.length > 0) {
    await insertBatchFn(batch);
    batchCount++;
    totalInserted += batch.length;
  }
  return { totalInserted, totalSkipped, batchCount };
}

async function run() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node import_leads.js <path-to-leads.csv|.xlsx>');
    process.exit(1);
  }
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error('File not found:', resolved);
    process.exit(1);
  }

  const ext = path.extname(resolved).toLowerCase();
  const isExcel = ext === '.xlsx' || ext === '.xls';
  const filenameHint = isColeFormatByFilename(resolved);

  console.log('File:', resolved);
  console.log('Batch size:', BATCH_SIZE);

  let isCole = filenameHint;
  let result;

  if (isExcel) {
    const workbook = XLSX.readFile(resolved, { cellDates: true, sheetRows: 1 });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const firstRow = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })[0] || [];
    isCole = isCole || isColeFormatByHeaders(firstRow);
    console.log('Format:', isCole ? 'Cole Data Dictionary (FA + CP)' : 'Generic Excel');
    result = await runXlsxImport(resolved, isCole);
  } else {
    const firstChunk = await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(resolved).pipe(
        parse({ columns: true, skip_empty_lines: true, trim: true, relax_column_count: true, to: 1 })
      );
      stream.on('data', (d) => { resolve(d); stream.destroy(); });
      stream.on('error', reject);
      stream.on('end', () => resolve(null));
    });
    const headers = firstChunk ? Object.keys(firstChunk) : [];
    isCole = isCole || isColeFormatByHeaders(headers);
    console.log('Format:', isCole ? 'Cole Data Dictionary (FA + CP)' : 'Generic CSV');
    result = await runCsvImport(resolved, isCole);
  }

  console.log('\nDone.');
  console.log('Total rows inserted:', result.totalInserted);
  console.log('Total rows skipped (no email):', result.totalSkipped);
  console.log('Batches:', result.batchCount);
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
