const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const { processUpload } = require('../../lib/lead_upload');
const { enrichLead } = require('../../lib/integrations');
const { BUSINESSES } = require('../../config/businesses');

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
 * Returns rows with both CRM column names (autoId_ui, email_addr) and frontend-friendly aliases (id, email).
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
      `SELECT autoId_ui, first_name, last_name, email_addr, phone_nbr, mobile_phone,
              ziarem_tags, address_1, city, state, zip_code
       FROM leads
       ORDER BY autoId_ui DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const data = result.rows.map((row) => ({
      ...row,
      id: row.autoId_ui,
      email: row.email_addr,
      phone: row.phone_nbr || row.mobile_phone,
      business_tags: Array.isArray(row.ziarem_tags) ? row.ziarem_tags : (row.ziarem_tags ? [row.ziarem_tags] : []),
    }));

    let total = null;
    if (includeTotal) {
      const totalResult = await pool.query('SELECT count(*)::int AS total FROM leads');
      total = totalResult.rows[0]?.total ?? 0;
    }

    res.json({
      data,
      pagination: {
        limit,
        offset,
        ...(total !== null && { total }),
        hasMore: total === null ? data.length === limit : offset + data.length < total,
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
 * Accepts: multipart form field "file" (.xlsx, .xls, .csv).
 * Optional: ?enrich=3 – run free APIs on first 3 inserted leads and save lat/lon + enrichment_result (max 5).
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded. Use form field "file".' });
    }
    const { rows, stats } = processUpload(req.file.buffer, req.file.originalname);
    const BATCH_SIZE = 1000;
    let inserted = 0;
    const insertedIds = [];
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      await insertBatch(batch);
      inserted += batch.length;
      batch.forEach((r) => insertedIds.push(r.autoId_ui));
    }

    let enrichCount = 0;
    const enrichParam = parseInt(req.query.enrich, 10);
    if (!Number.isNaN(enrichParam) && enrichParam > 0 && insertedIds.length > 0) {
      const toEnrich = insertedIds.slice(0, Math.min(5, enrichParam));
      for (const id of toEnrich) {
        try {
          const row = (await pool.query(
            `SELECT autoId_ui, address_1, address_2, city, state, zip_code, email_addr, phone_nbr, mobile_phone, ip_addr, lat, lon FROM leads WHERE autoId_ui = $1`,
            [id]
          )).rows[0];
          if (row) {
            const enrichment = await enrichLead(row, { rateLimitMs: 1100 });
            const updates = [];
            const values = [];
            let idx = 1;
            if (enrichment.geocode?.lat != null && enrichment.geocode?.lon != null) {
              updates.push(`lat = $${idx++}`, `lon = $${idx++}`);
              values.push(enrichment.geocode.lat, enrichment.geocode.lon);
            }
            const cache = {
              email: enrichment.email,
              phone: enrichment.phone,
              ip: enrichment.ip,
              geocode: enrichment.geocode ? { display_name: enrichment.geocode.display_name } : null,
              updated_at: new Date().toISOString(),
            };
            updates.push(`enrichment_result = $${idx++}`);
            values.push(JSON.stringify(cache));
            values.push(id);
            try {
              await pool.query(`UPDATE leads SET ${updates.join(', ')} WHERE autoId_ui = $${idx}`, values);
              enrichCount++;
            } catch (_) {}
          }
        } catch (_) {}
      }
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
      enriched: enrichCount > 0 ? enrichCount : undefined,
    });
  } catch (err) {
    console.error('POST /leads/upload error:', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

/** Build scoring breakdown: ziarem_tags with business name and description. */
function scoringBreakdown(ziaremTags) {
  const tags = Array.isArray(ziaremTags) ? ziaremTags : (ziaremTags ? [ziaremTags] : []);
  const byTag = new Map();
  for (const b of BUSINESSES) {
    for (const t of b.ziarem_tags) byTag.set(t, { business: b.name, badge: b.badge, description: b.description });
  }
  return tags.map((tag) => ({
    tag,
    business: byTag.get(tag)?.business ?? null,
    badge: byTag.get(tag)?.badge ?? null,
    description: byTag.get(tag)?.description ?? null,
  }));
}

/**
 * GET /leads/:id
 * Lead detail: full contact info, scoring breakdown (ziarem_tags with business labels), and communication history.
 * Use when opening a lead row in the UI.
 */
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid lead id' });

    const leadResult = await pool.query(
      `SELECT autoId_ui, first_name, middle_init, last_name, name_suffix, DOB, gender_cd,
              address_1, address_2, city, state, zip_code, zip_cd_4,
              phone_nbr, mobile_phone, email_addr,
              home_owner_flag, home_value, home_market_value, length_of_residence, credit_rating,
              occupation_code, occupation, doc_type_code,
              ziarem_tags, enrichment_result, lat, lon
       FROM leads WHERE autoId_ui = $1`,
      [id]
    );
    if (!leadResult.rows[0]) return res.status(404).json({ error: 'Lead not found' });

    const row = leadResult.rows[0];
    const contact = {
      id: row.autoId_ui,
      autoId_ui: row.autoId_ui,
      first_name: row.first_name,
      middle_init: row.middle_init,
      last_name: row.last_name,
      name_suffix: row.name_suffix,
      full_name: [row.first_name, row.middle_init, row.last_name, row.name_suffix].filter(Boolean).join(' ').trim() || null,
      DOB: row.DOB,
      gender_cd: row.gender_cd,
      address_1: row.address_1,
      address_2: row.address_2,
      city: row.city,
      state: row.state,
      zip_code: row.zip_code,
      zip_cd_4: row.zip_cd_4,
      phone_nbr: row.phone_nbr,
      mobile_phone: row.mobile_phone,
      email_addr: row.email_addr,
      home_owner_flag: row.home_owner_flag,
      home_value: row.home_value,
      home_market_value: row.home_market_value,
      length_of_residence: row.length_of_residence,
      credit_rating: row.credit_rating,
      occupation_code: row.occupation_code,
      occupation: row.occupation,
      doc_type_code: row.doc_type_code,
      lat: row.lat,
      lon: row.lon,
    };

    const tags = Array.isArray(row.ziarem_tags) ? row.ziarem_tags : (row.ziarem_tags ? [row.ziarem_tags] : []);
    const scoring = {
      tags,
      breakdown: scoringBreakdown(row.ziarem_tags),
      enrichment: row.enrichment_result || null,
    };

    const commResult = await pool.query(
      `SELECT c.id, c.lead_id, c.direction, c.subject, c.body_text, c.body_html, c.sent_at, c.business_id, b.business_name
       FROM communications c
       LEFT JOIN business_emails b ON b.id = c.business_id
       WHERE c.lead_id = $1 ORDER BY c.sent_at DESC`,
      [id]
    );

    res.json({
      lead: contact,
      scoring,
      communications: commResult.rows,
    });
  } catch (err) {
    if (err.code === '42703') {
      return res.status(500).json({ error: 'Lead detail columns may not exist; ensure schema includes occupation, DOB, etc.' });
    }
    console.error('GET /leads/:id error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch lead detail' });
  }
});

/**
 * GET /leads/:id/enrich
 * Enrich one lead using free APIs: geocoding (Nominatim), email validation (Abstract), phone validation (Abstract/NumVerify), IP geo (ip-api.com).
 * :id = lead autoId_ui. Returns { geocode, email, phone, ip, errors? }.
 * ?save=1 – persist geocode (lat/lon) and cache enrichment_result JSONB on the lead.
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

    const save = req.query.save === '1';
    if (save) {
      const updates = [];
      const values = [];
      let idx = 1;
      if (enrichment.geocode?.lat != null && enrichment.geocode?.lon != null) {
        updates.push(`lat = $${idx++}`, `lon = $${idx++}`);
        values.push(enrichment.geocode.lat, enrichment.geocode.lon);
      }
      const cache = {
        email: enrichment.email,
        phone: enrichment.phone,
        ip: enrichment.ip,
        geocode: enrichment.geocode ? { display_name: enrichment.geocode.display_name } : null,
        updated_at: new Date().toISOString(),
      };
      updates.push(`enrichment_result = $${idx++}`);
      values.push(JSON.stringify(cache));
      values.push(id);
      try {
        await pool.query(
          `UPDATE leads SET ${updates.join(', ')} WHERE autoId_ui = $${idx}`,
          values
        );
      } catch (e) {
        if (e.code === '42703') {
          // column "enrichment_result" does not exist – run migration 006
          console.warn('leads.enrichment_result missing; run database/schema/006_add_enrichment_result.sql');
        } else throw e;
      }
    }

    res.json({ leadId: id, saved: save, ...enrichment });
  } catch (err) {
    console.error('GET /leads/:id/enrich error:', err);
    res.status(500).json({ error: err.message || 'Enrichment failed' });
  }
});

/**
 * POST /leads/enrich-batch
 * Enrich multiple leads and optionally save. Body: { leadIds: number[], save?: boolean }.
 * Max 10 ids per request; rate-limited (Nominatim 1/sec) so response may take ~10s.
 */
router.post('/enrich-batch', async (req, res) => {
  try {
    const { leadIds = [], save: saveFlag = false } = req.body || {};
    const ids = Array.isArray(leadIds) ? leadIds.slice(0, 10) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'leadIds array required (max 10)' });

    const results = [];
    for (const id of ids) {
      const r = await pool.query(
        `SELECT autoId_ui, address_1, address_2, city, state, zip_code, email_addr, phone_nbr, mobile_phone, ip_addr, lat, lon
         FROM leads WHERE autoId_ui = $1`,
        [id]
      );
      if (!r.rows[0]) {
        results.push({ leadId: id, error: 'not_found' });
        continue;
      }
      const enrichment = await enrichLead(r.rows[0], { rateLimitMs: 1100 });
      if (saveFlag) {
        const updates = [];
        const values = [];
        let idx = 1;
        if (enrichment.geocode?.lat != null && enrichment.geocode?.lon != null) {
          updates.push(`lat = $${idx++}`, `lon = $${idx++}`);
          values.push(enrichment.geocode.lat, enrichment.geocode.lon);
        }
        const cache = {
          email: enrichment.email,
          phone: enrichment.phone,
          ip: enrichment.ip,
          geocode: enrichment.geocode ? { display_name: enrichment.geocode.display_name } : null,
          updated_at: new Date().toISOString(),
        };
        updates.push(`enrichment_result = $${idx++}`);
        values.push(JSON.stringify(cache));
        values.push(id);
        try {
          await pool.query(
            `UPDATE leads SET ${updates.join(', ')} WHERE autoId_ui = $${idx}`,
            values
          );
        } catch (e) {
          if (e.code !== '42703') throw e;
        }
      }
      results.push({ leadId: id, ...enrichment, saved: saveFlag });
    }
    res.json({ results });
  } catch (err) {
    console.error('POST /leads/enrich-batch error:', err);
    res.status(500).json({ error: err.message || 'Enrichment failed' });
  }
});

module.exports = router;
