/**
 * Detects if a file or header row is in Cole Data Dictionary (FA + CP) format.
 * Cole format: first sheet or CSV has ID_Individuals, first_name, last_name, email_addr, etc.
 */
const COLE_SIGNATURE_COLS = [
  'ID_Individuals',
  'first_name',
  'last_name',
  'email_addr',
];

function normalizeHeader(h) {
  if (h == null) return '';
  return String(h).trim();
}

/**
 * @param {string[]} headers - First row column names
 * @returns {boolean} true if this looks like Cole FA + CP data
 */
function isColeFormatByHeaders(headers) {
  if (!Array.isArray(headers) || headers.length < 4) return false;
  const normalized = headers.map((h) => normalizeHeader(h));
  const set = new Set(normalized);
  const hasAll = COLE_SIGNATURE_COLS.every((col) =>
    set.has(col) || set.has(col.replace(/_/g, ' '))
  );
  return hasAll;
}

/**
 * @param {string} filePath - Full or short filename
 * @returns {boolean} true if filename suggests Cole / Data Dictionary
 */
function isColeFormatByFilename(filePath) {
  if (!filePath) return false;
  const name = filePath.split(/[/\\]/).pop() || '';
  const lower = name.toLowerCase();
  return (
    lower.includes('cole') ||
    lower.includes('data dictionary') ||
    lower.includes('data_dictionary') ||
    lower.includes('fa + cp') ||
    lower.includes('fa_cp')
  );
}

module.exports = {
  isColeFormatByHeaders,
  isColeFormatByFilename,
  COLE_SIGNATURE_COLS,
};
