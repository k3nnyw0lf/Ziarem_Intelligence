/**
 * Lead upload: parse Excel/CSV, auto-organize (normalize + map columns), dedupe, apply Ziarem tags.
 * Used by POST /leads/upload (drag-and-drop) and can be used by other import flows.
 */

const XLSX = require('xlsx');
const { parse } = require('csv-parse/sync');

const COLUMN_MAP = {
  'autoId_ui#': 'autoId_ui',
  'mobile_ui#': 'mobile_ui',
  'CurrentSaleDocumentType': 'doc_type_code',
  'PropertyClassID': 'prop_cl_ind',
  'Address Type': 'address_type',
  'Occupation Code': 'occupation_code',
  'DOC_TYPE': 'doc_type_code',
  'CreditRating': 'credit_rating',
  'HomeOwner': 'home_owner_flag',
  'YearBuilt': 'YearBuilt',
  'PoolCode': 'PoolCode',
  'RoofCoverCode': 'RoofCoverCode',
  'FirstMtgInterestRateType': 'FirstMtgInterestRateType',
  'Email': 'email_addr',
  'E-mail': 'email_addr',
};

const WOLF_RENO_OCC_CODES = new Set(['A074', 'A042', 'F269', 'F301', 'F287', '35', '32']);
const DISPUTE_DOC_CODES = new Set(['77', '34', '81']);
const DISPUTE_BAD_CREDIT = new Set(['C', 'D', 'E']);
const LYCO_OCC_CODES = new Set(['11', '20', '49', '38']);
const LYCO_HNW_THRESHOLD = 1_000_000;
const DOS_REFI_ADJ = 'ADJ';
const DOS_FTB_CREDIT = 'A';
const DOS_FTB_OWNER = 'RENTER';
const RE4LTY_MAX_YEAR = 1980;
const RE4LTY_MAX_VALUE = 300000;
const CLOSED_BY_WHOM_DOC = '12';
const WOLF_INS_ROOF_WOOD_SHAKE = '13';

const SYNTHETIC_ID_START = 9000000000000; // IDs >= this are generated (no Cole autoId_ui)

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

  if (WOLF_RENO_OCC_CODES.has(occCode)) tags.push('WOLF_RENO_TARGET');
  if (DISPUTE_DOC_CODES.has(docCode) || (creditRating && DISPUTE_BAD_CREDIT.has(creditRating))) tags.push('DISPUTE_DISTRESSED');
  if (LYCO_OCC_CODES.has(occCode) || (homeVal != null && homeVal > LYCO_HNW_THRESHOLD)) tags.push('LYCO_TAX_LEAD');
  if (firstMtgRateType === DOS_REFI_ADJ) tags.push('DOS_REFI_TARGET');
  if (creditRating === DOS_FTB_CREDIT && homeOwner === DOS_FTB_OWNER) tags.push('DOS_FIRST_TIME_BUYER');
  if (yearBuilt != null && yearBuilt < RE4LTY_MAX_YEAR && homeVal != null && homeVal < RE4LTY_MAX_VALUE) tags.push('RE4LTY_FLIP_OPPORTUNITY');
  if (docCode === CLOSED_BY_WHOM_DOC) tags.push('CLOSED_BY_WHOM_TITLE');
  if (poolCode !== '') tags.push('WOLF_INSURANCE_LIABILITY');
  if (roofCoverCode === WOLF_INS_ROOF_WOOD_SHAKE) tags.push('WOLF_INSURANCE_HIGH_RISK');

  return tags;
}

/** Normalize value: trim strings, empty string -> null */
function normalizeValue(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    const s = v.trim();
    return s === '' ? null : s;
  }
  if (typeof v === 'number' && Number.isNaN(v)) return null;
  return v;
}

/** Normalize row: map to DB columns, trim all values, ensure autoId_ui and email */
function normalizeRow(row, index) {
  const db = mapRowToDb(row);
  const out = {};
  for (const [k, v] of Object.entries(db)) {
    out[k] = normalizeValue(v);
  }
  const email = (out.email_addr || '').toString().trim().toLowerCase();
  if (!email) return null;
  const autoId = out.autoId_ui ?? out['autoId_ui#'];
  out.autoId_ui = autoId != null && autoId !== '' ? Number(autoId) : SYNTHETIC_ID_START + index;
  const tags = applyZiaremLogic({ ...row, ...out });
  out.ziarem_tags = tags.length ? JSON.stringify(tags) : null;
  return out;
}

/** Dedupe by normalized email (keep first). Returns { rows, duplicatesRemoved } */
function dedupeByEmail(rows) {
  const seen = new Set();
  const out = [];
  let duplicatesRemoved = 0;
  for (const row of rows) {
    const email = (row.email_addr || '').toString().trim().toLowerCase();
    if (!email) continue;
    if (seen.has(email)) {
      duplicatesRemoved++;
      continue;
    }
    seen.add(email);
    out.push(row);
  }
  return { rows: out, duplicatesRemoved };
}

/** Parse buffer to array of row objects. filename used for extension. */
function parseFile(buffer, filename) {
  const ext = (filename || '').toLowerCase();
  if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  }
  if (ext.endsWith('.csv')) {
    const text = buffer.toString('utf8');
    return parse(text, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
  }
  throw new Error('Unsupported file type. Use .xlsx, .xls, or .csv');
}

/**
 * Process upload: parse -> normalize -> dedupe by email -> return rows ready for insert + stats.
 */
function processUpload(buffer, filename) {
  const raw = parseFile(buffer, filename);
  const stats = { total: raw.length, skippedNoEmail: 0, duplicatesRemoved: 0, tagged: 0 };

  const normalized = [];
  for (let i = 0; i < raw.length; i++) {
    const row = normalizeRow(raw[i], i);
    if (!row) {
      stats.skippedNoEmail++;
      continue;
    }
    if (row.ziarem_tags) stats.tagged++;
    normalized.push(row);
  }

  const { rows, duplicatesRemoved } = dedupeByEmail(normalized);
  stats.duplicatesRemoved = duplicatesRemoved;
  stats.imported = rows.length;

  return { rows, stats };
}

module.exports = {
  parseFile,
  processUpload,
  normalizeRow,
  dedupeByEmail,
  applyZiaremLogic,
  mapRowToDb,
  COLUMN_MAP,
};
