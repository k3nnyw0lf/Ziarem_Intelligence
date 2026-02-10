#!/usr/bin/env node
/**
 * Ziarem CRM – import main lead file; apply active-company tags (Wolf Reno, Dispute, Lyco, Dos, Re4lty, Wolf Insurance).
 * Uses fs streams + csv-parse; saves tags to ziarem_tags JSONB for dashboard filtering.
 *
 * Usage: node import_and_score.js <path-to-main-leads.csv>
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { pool } = require('./src/db');

const BATCH_SIZE = 1000;

const COLUMN_MAP = {
  'autoId_ui#': 'autoId_ui',
  'mobile_ui#': 'mobile_ui',
  'CurrentSaleDocumentType': 'doc_type_code',
  'PropertyClassID': 'prop_cl_ind',
  'Address Type': 'address_type',
};

// 1. Wolf Surety & Reno LLC – occupation_code (Occupation CSVs)
const WOLF_RENO_OCC_CODES = new Set(['A074', 'A042', 'F269', 'F301', 'F287', '35', '32']); // Contractor, Builder, Electrician, Welder, Plumber, Electricians, Architects

// 2. Dispute LLC – doc_type_code (DOC_TYPE.csv) or CreditRating
const DISPUTE_DOC_CODES = new Set(['77', '34', '81']); // Notice of Default, Foreclosure, Notice of Sale
const DISPUTE_BAD_CREDIT = new Set(['C', 'D', 'E']);

// 3. Lyco Inc – occupation_code or high net worth
const LYCO_OCC_CODES = new Set(['11', '20', '49', '38']); // Self Employed, Business Owner, Doctors, Attorneys
const LYCO_HNW_THRESHOLD = 1_000_000;

// 4. Dos Mortgage – FirstMtgInterestRateType = ADJ; or CreditRating A + HomeOwner Renter
const DOS_REFI_ADJ = 'ADJ';
const DOS_FTB_CREDIT = 'A';
const DOS_FTB_OWNER = 'RENTER';

// 5. Re4lty – year_built < 1980 AND home_market_value < 300000; doc_type 12 = Bargain and Sale Deed
const RE4LTY_MAX_YEAR = 1980;
const RE4LTY_MAX_VALUE = 300000;
const CLOSED_BY_WHOM_DOC = '12';

// 6. Wolf Insurance – pool_code not empty; roof_cover_code = '13' (Wood Shake)
const WOLF_INS_ROOF_WOOD_SHAKE = '13';

function str(row, ...keys) {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function num(row, ...keys) {
  const s = str(row, ...keys);
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

function mapRowToDb(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const col = COLUMN_MAP[k] ?? k;
    out[col] = v === '' ? null : v;
  }
  return out;
}

function applyZiaremLogic(row) {
  const tags = [];
  const occCode = str(row, 'occupation_code', 'Occupation Code', 'occupation');
  const docCode = str(row, 'doc_type_code', 'CurrentSaleDocumentType', 'DOC_TYPE');
  const creditRating = str(row, 'CreditRating', 'credit_rating').toUpperCase();
  const homeVal = num(row, 'home_market_value', 'home_value', 'curr_home_value');
  const yearBuilt = num(row, 'year_built', 'YearBuilt');
  const poolCode = str(row, 'pool_code', 'PoolCode', 'Pool');
  const roofCoverCode = str(row, 'roof_cover_code', 'RoofCoverCode');
  const firstMtgRateType = str(row, 'FirstMtgInterestRateType', 'first_mtg_interest_rate_type').toUpperCase();
  const homeOwner = str(row, 'HomeOwner', 'home_owner_flag', 'owner_occupied').toUpperCase();

  // 1. Wolf Surety & Reno LLC
  if (WOLF_RENO_OCC_CODES.has(occCode)) {
    tags.push('WOLF_RENO_TARGET');
  }

  // 2. Dispute LLC
  if (DISPUTE_DOC_CODES.has(docCode) || (creditRating && DISPUTE_BAD_CREDIT.has(creditRating))) {
    tags.push('DISPUTE_DISTRESSED');
  }

  // 3. Lyco Inc
  if (LYCO_OCC_CODES.has(occCode) || (homeVal != null && homeVal > LYCO_HNW_THRESHOLD)) {
    tags.push('LYCO_TAX_LEAD');
  }

  // 4. Dos Mortgage & Laenan
  if (firstMtgRateType === DOS_REFI_ADJ) {
    tags.push('DOS_REFI_TARGET');
  }
  if (creditRating === DOS_FTB_CREDIT && homeOwner === DOS_FTB_OWNER) {
    tags.push('DOS_FIRST_TIME_BUYER');
  }

  // 5. Re4lty & Closed By Whom
  if (yearBuilt != null && yearBuilt < RE4LTY_MAX_YEAR && homeVal != null && homeVal < RE4LTY_MAX_VALUE) {
    tags.push('RE4LTY_FLIP_OPPORTUNITY');
  }
  if (docCode === CLOSED_BY_WHOM_DOC) {
    tags.push('CLOSED_BY_WHOM_TITLE');
  }

  // 6. Wolf Insurance
  if (poolCode !== '') {
    tags.push('WOLF_INSURANCE_LIABILITY');
  }
  if (roofCoverCode === WOLF_INS_ROOF_WOOD_SHAKE) {
    tags.push('WOLF_INSURANCE_HIGH_RISK');
  }

  return tags;
}

function quoteCol(c) {
  return /^[a-z_][a-z0-9_]*$/i.test(c) ? c : '"' + c.replace(/"/g, '""') + '"';
}

async function insertBatch(rows) {
  if (rows.length === 0) return;
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const placeholders = [];
  const values = [];
  let idx = 1;
  for (const row of rows) {
    placeholders.push('(' + cols.map(() => `$${idx++}`).join(', ') + ')');
    values.push(...cols.map((c) => (row[c] != null && row[c] !== '' ? row[c] : null)));
  }
  const sql = `INSERT INTO leads (${cols.map(quoteCol).join(', ')}) VALUES ${placeholders.join(', ')} ON CONFLICT (autoId_ui) DO NOTHING`;
  await pool.query(sql, values);
}

function run() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: node import_and_score.js <path-to-main-leads.csv>');
    process.exit(1);
  }
  const resolved = path.resolve(csvPath);
  if (!fs.existsSync(resolved)) {
    console.error('File not found:', resolved);
    process.exit(1);
  }

  let batch = [];
  let total = 0;
  let skipped = 0;
  let batchCount = 0;

  const parser = fs.createReadStream(resolved).pipe(
    parse({ columns: true, skip_empty_lines: true, trim: true, relax_column_count: true })
  );

  parser.on('data', (record) => {
    const dbRow = mapRowToDb(record);
    const autoId = dbRow.autoId_ui ?? dbRow['autoId_ui#'];
    if (autoId == null || autoId === '') {
      skipped++;
      return;
    }
    if (!dbRow.autoId_ui) dbRow.autoId_ui = autoId;

    const tags = applyZiaremLogic({ ...record, ...dbRow });
    dbRow.ziarem_tags = tags.length ? JSON.stringify(tags) : null;

    batch.push(dbRow);
    if (batch.length >= BATCH_SIZE) {
      parser.pause();
      insertBatch(batch)
        .then(() => {
          batchCount++;
          total += batch.length;
          process.stderr.write(`\rBatch ${batchCount}: ${total} inserted, ${skipped} skipped`);
          batch = [];
          parser.resume();
        })
        .catch((err) => {
          console.error('\nInsert error:', err.message);
          process.exit(1);
        });
    }
  });

  parser.on('end', async () => {
    if (batch.length > 0) {
      try {
        await insertBatch(batch);
        batchCount++;
        total += batch.length;
      } catch (err) {
        console.error('\nFinal batch error:', err.message);
        process.exit(1);
      }
    }
    console.log('\nDone. Total inserted:', total, '| Skipped:', skipped, '| Batches:', batchCount);
    await pool.end();
  });

  parser.on('error', (err) => {
    console.error('CSV error:', err);
    process.exit(1);
  });
}

run();
