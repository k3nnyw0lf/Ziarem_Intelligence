/**
 * Maps a row from Cole Data Dictionary (FA + CP) export to leads table shape.
 * Column names from Cole_Data Dictionary_Apr2024.xlsx "FA + CP Data Appended" sheet.
 */
const ALLOWED_TAGS = new Set(['Lyco', 'Wolf', 'Dispute']);

function str(val, maxLen = 255) {
  if (val == null || val === '') return null;
  const s = String(val).trim();
  return s.length ? s.slice(0, maxLen) : null;
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

/**
 * @param {Record<string, any>} row - One row (object keyed by Cole column names)
 * @returns {Record<string, any>|null} lead row for DB, or null to skip
 */
function mapColeRow(row) {
  const get = (k) => row[k];
  const email = str(get('email_addr'));
  if (!email) return null;

  const sourceId = get('ID_Individuals');
  const sourceIdStr = sourceId != null && sourceId !== '' ? String(sourceId).trim() : null;

  const firstName = str(get('first_name')) || 'Unknown';
  const lastName = str(get('last_name')) || 'Unknown';
  const phone = str(get('phone_nbr'), 50);
  const mobile = str(get('mobile_phone'), 50);
  const address1 = str(get('address_1'));
  const city = str(get('city'), 100);
  const state = str(get('state'), 20);
  const zip = str(get('zip_code'), 20);

  const businessTags = parseTags(get('business_tags'));
  const leadScore = parseScore(get('lead_score'));

  return {
    id: null,
    first_name: firstName,
    last_name: lastName,
    email,
    phone,
    mobile_phone: mobile,
    business_tags: businessTags,
    lead_score: leadScore,
    created_at: new Date().toISOString(),
    source: 'Cole',
    source_id: sourceIdStr,
    address_1: address1,
    city,
    state,
    zip_code: zip,
  };
}

module.exports = { mapColeRow };
