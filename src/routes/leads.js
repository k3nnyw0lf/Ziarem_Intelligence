const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const { processUpload } = require('../../lib/lead_upload');
const { enrichLead } = require('../../lib/integrations');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50 MB

let allowedLeadColumns = null;
async function getAllowedLeadColumns() {
  if (allowedLeadColumns) return allowedLeadColumns;
  const r = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads'");
  allowedLeadColumns = new Set(r.rows.map((row) => row.column_name));
  return allowedLeadColumns;
}

function quoteCol(c) {
  return /^[a-z_][a-z0-9_]*$/i.test(c) ? c : '"' + c.replace(/"/g, '""') + '"';
}

function filterRowToTableColumns(row, allowed) {
  const out = {};
  for (const k of Object.keys(row)) {
    if (allowed.has(k)) out[k] = row[k];
  }
  return out;
}

async function insertBatch(rows) {
  if (rows.length === 0) return;
  const allowed = await getAllowedLeadColumns();
  const filtered = rows.map((r) => filterRowToTableColumns(r, allowed));
  const cols = [...new Set(filtered.flatMap((r) => Object.keys(r)))].filter((c) => c);
  if (cols.length === 0) return;
  const placeholders = [];
  const values = [];
  let idx = 1;
  for (const row of filtered) {
    placeholders.push('(' + cols.map((c) => `$${idx++}`).join(', ') + ')');
    values.push(...cols.map((c) => (row[c] != null && row[c] !== '' ? row[c] : null)));
  }
  const sql = `INSERT INTO leads (${cols.map(quoteCol).join(', ')}) VALUES ${placeholders.join(', ')} ON CONFLICT (autoId_ui) DO NOTHING`;
  await pool.query(sql, values);
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * GET /leads
 * Server-side pagination: ?limit=50&offset=0 (defaults: limit=50, offset=0)
 * ?total=0 skips COUNT query (faster on 1M+ rows when exact total not needed).
 * Prevents frontend from loading entire table (safe for 1M+ rows).
 */
router.get('/', async (req, res) => {
  try {
    let limit = parseInt(req.query.limit, 10);
    let offset = parseInt(req.query.offset, 10);
    const includeTotal = req.query.total !== '0';

    if (Number.isNaN(limit) || limit < 1) limit = DEFAULT_LIMIT;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;
    if (Number.isNaN(offset) || offset < 0) offset = 0;

    const result = await pool.query(
      `SELECT id, first_name, last_name, email, phone, mobile_phone, business_tags, lead_score, created_at,
              source, source_id, address_1, city, state, zip_code
       FROM leads
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    let total = null;
    if (includeTotal) {
      const totalResult = await pool.query('SELECT count(*)::int AS total FROM leads');
      total = totalResult.rows[0]?.total ?? 0;
    }

    res.json({
      data: result.rows,
      pagination: {
        limit,
        offset,
        ...(total !== null && { total }),
        hasMore: total === null ? result.rows.length === limit : offset + result.rows.length < total,
      },
    });
  } catch (err) {
    console.error('GET /leads error:', err);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

/**
 * POST /leads/upload
 * Drag-and-drop Excel or CSV: parse, auto-organize (normalize + map Cole columns), dedupe by email, apply Ziarem tags, insert.
 * Accepts: multipart form field "file" (.xlsx, .xls, .csv)
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded. Use form field "file".' });
    }
    const { rows, stats } = processUpload(req.file.buffer, req.file.originalname);
    const BATCH_SIZE = 1000;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      await insertBatch(batch);
      inserted += batch.length;
    }
    res.json({
      ok: true,
      filename: req.file.originalname,
      stats: {
        totalRows: stats.total,
        skippedNoEmail: stats.skippedNoEmail,
        duplicatesRemoved: stats.duplicatesRemoved,
        imported: stats.imported,
        tagged: stats.tagged,
      },
      inserted,
    });
  } catch (err) {
    console.error('POST /leads/upload error:', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

/**
 * GET /leads/:id/enrich
 * Enrich one lead using free APIs: geocoding (Nominatim), email validation (Abstract), phone validation (Abstract/NumVerify), IP geo (ip-api.com).
 * :id = lead autoId_ui. Returns { geocode, email, phone, ip, errors? }.
 */
router.get('/:id/enrich', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid lead id' });

    const r = await pool.query(
      `SELECT autoId_ui, address_1, address_2, city, state, zip_code, email_addr, phone_nbr, mobile_phone, ip_addr, lat, lon
       FROM leads WHERE autoId_ui = $1`,
      [id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Lead not found' });

    const enrichment = await enrichLead(r.rows[0], {
      skipGeocode: req.query.skip_geocode === '1',
      skipEmail: req.query.skip_email === '1',
      skipPhone: req.query.skip_phone === '1',
      skipIp: req.query.skip_ip === '1',
    });
    res.json({ leadId: id, ...enrichment });
  } catch (err) {
    console.error('GET /leads/:id/enrich error:', err);
    res.status(500).json({ error: err.message || 'Enrichment failed' });
  }
});

module.exports = router;
