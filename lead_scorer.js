/**
 * Ziarem Intelligence Engine – lead classification (Wolf Surety, Dispute LLC, Lyco Tax).
 * Run when a new lead is inserted (e.g. from API or import pipeline).
 *
 * Tags:
 *   Wolf_Trade          – occupation = Contractor/Builder/Electrician/Plumber (dict_occupations)
 *   Distressed_Property – doc_type = Notice of Default (77) or Foreclosure (34) (dict_doc_types)
 *   Credit_Repair_Urgent – credit_rating Low/poor/fair OR doc_type = 77
 *   Lyco_HighNetWorth   – home_value or curr_home_value > $1M OR net_worth High
 *   Lyco_Business       – occupation = Self Employed or Business Owner
 *
 * Usage:
 *   const { scoreLead, scoreLeadsBatch } = require('./lead_scorer');
 *   const tags = await scoreLead(leadRow, { pool });
 *   const tagMap = await scoreLeadsBatch(leadRows, { pool });
 *
 * Hot leads (any of these tags) are also exposed by the SQL view view_hot_leads.
 */

const WOLF_TRADE_OCCUPATIONS = new Set(['contractor', 'builder', 'electrician', 'plumber']);
const DISTRESSED_DOC_CODES = new Set(['77', '34']); // 77 = Notice of Default, 34 = Foreclosure
const CREDIT_REPAIR_DOC_CODE = '77'; // Notice of Default
const LYCO_BUSINESS_OCCUPATIONS = new Set(['self employed', 'business owner']);
const HIGH_NET_WORTH_THRESHOLD = 1_000_000;
const CREDIT_LOW_VALUES = new Set(['low', 'poor', 'fair', 'below average']);

function normalize(s) {
  return (s == null ? '' : String(s)).trim().toLowerCase();
}

function isCreditLow(creditRating) {
  if (creditRating == null || String(creditRating).trim() === '') return false;
  const n = normalize(creditRating);
  return CREDIT_LOW_VALUES.has(n) || n.includes('low') || n.includes('poor');
}

function isHighNetWorth(netWorth) {
  if (netWorth == null) return false;
  const v = parseFloat(netWorth);
  if (!Number.isNaN(v)) return v >= HIGH_NET_WORTH_THRESHOLD;
  return normalize(netWorth).includes('high');
}

function isHomeValueOver1M(homeValue, currHomeValue) {
  const hv = homeValue != null ? parseFloat(homeValue) : NaN;
  const chv = currHomeValue != null ? parseFloat(currHomeValue) : NaN;
  const max = Math.max(Number.isNaN(hv) ? 0 : hv, Number.isNaN(chv) ? 0 : chv);
  return max >= HIGH_NET_WORTH_THRESHOLD;
}

/**
 * Classify a single lead using dictionary lookups. Call after fetching occupation and doc_type descriptions.
 * @param {Object} lead - Raw lead row (occupation_code, CurrentSaleDocumentType, credit_rating, home_value, curr_home_value, net_worth)
 * @param {Object} opts - { occupationDescription, docTypeDescription } (from dicts) or { pool } to fetch
 * @returns {Promise<string[]>} Array of tags (e.g. ['Wolf_Trade', 'Lyco_HighNetWorth'])
 */
async function scoreLead(lead, opts = {}) {
  const tags = new Set();
  const occDesc = opts.occupationDescription != null
    ? normalize(opts.occupationDescription)
    : null;
  const docCode = lead.CurrentSaleDocumentType != null ? String(lead.CurrentSaleDocumentType).trim() : '';
  const docDesc = opts.docTypeDescription != null ? normalize(opts.docTypeDescription) : '';

  if (opts.pool && (lead.occupation_code != null || lead.CurrentSaleDocumentType != null)) {
    if (lead.occupation_code != null && occDesc === null) {
      const r = await opts.pool.query(
        'SELECT description FROM dict_occupations WHERE code = $1',
        [lead.occupation_code]
      );
      if (r.rows[0]) opts.occupationDescription = r.rows[0].description;
    }
    if (lead.CurrentSaleDocumentType != null && opts.docTypeDescription === undefined) {
      const r = await opts.pool.query(
        'SELECT description FROM dict_doc_types WHERE code = $1',
        [lead.CurrentSaleDocumentType]
      );
      if (r.rows[0]) opts.docTypeDescription = r.rows[0].description;
    }
  }

  const occDescNorm = opts.occupationDescription != null ? normalize(opts.occupationDescription) : '';
  const docDescNorm = opts.docTypeDescription != null ? normalize(opts.docTypeDescription) : '';

  // —— Wolf Surety ——
  if (WOLF_TRADE_OCCUPATIONS.has(occDescNorm) || [...WOLF_TRADE_OCCUPATIONS].some((o) => occDescNorm.includes(o))) {
    tags.add('Wolf_Trade');
  }
  if (DISTRESSED_DOC_CODES.has(docCode) || docDescNorm.includes('notice of default') || docDescNorm.includes('foreclosure')) {
    tags.add('Distressed_Property');
  }

  // —— Dispute LLC ——
  if (isCreditLow(lead.credit_rating) || docCode === CREDIT_REPAIR_DOC_CODE) {
    tags.add('Credit_Repair_Urgent');
  }

  // —— Lyco Tax ——
  if (isHomeValueOver1M(lead.home_value, lead.curr_home_value) || isHighNetWorth(lead.net_worth)) {
    tags.add('Lyco_HighNetWorth');
  }
  if (LYCO_BUSINESS_OCCUPATIONS.has(occDescNorm) || [...LYCO_BUSINESS_OCCUPATIONS].some((o) => occDescNorm.includes(o))) {
    tags.add('Lyco_Business');
  }

  return [...tags];
}

/**
 * Score many leads (e.g. after bulk insert). Returns Map of lead key -> tags.
 * Lead key: use "autoId_ui#" or ID_Individuals if present.
 */
async function scoreLeadsBatch(leads, opts = {}) {
  const { pool } = opts;
  if (!pool || !leads.length) return new Map();

  const occCodes = [...new Set(leads.map((l) => l.occupation_code).filter(Boolean))];
  const docCodes = [...new Set(leads.map((l) => l.CurrentSaleDocumentType).filter(Boolean))];

  const occRows = occCodes.length
    ? await pool.query('SELECT code, description FROM dict_occupations WHERE code = ANY($1)', [occCodes])
    : { rows: [] };
  const docRows = docCodes.length
    ? await pool.query('SELECT code, description FROM dict_doc_types WHERE code = ANY($1)', [docCodes])
    : { rows: [] };

  const occMap = new Map(occRows.rows.map((r) => [String(r.code).trim(), r.description]));
  const docMap = new Map(docRows.rows.map((r) => [String(r.code).trim(), r.description]));

  const result = new Map();
  for (const lead of leads) {
    const key = lead['autoId_ui#'] ?? lead['autoId_ui'] ?? lead.ID_Individuals ?? lead.email_addr ?? null;
    const tags = await scoreLead(lead, {
      occupationDescription: lead.occupation_code != null ? occMap.get(String(lead.occupation_code).trim()) : null,
      docTypeDescription: lead.CurrentSaleDocumentType != null ? docMap.get(String(lead.CurrentSaleDocumentType).trim()) : null,
    });
    if (key != null) result.set(key, tags);
  }
  return result;
}

module.exports = {
  scoreLead,
  scoreLeadsBatch,
  WOLF_TRADE_OCCUPATIONS,
  DISTRESSED_DOC_CODES,
  LYCO_BUSINESS_OCCUPATIONS,
  CREDIT_REPAIR_DOC_CODE,
  HIGH_NET_WORTH_THRESHOLD,
};
