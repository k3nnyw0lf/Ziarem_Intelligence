const express = require('express');
const { pool } = require('../db');

const router = express.Router();

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

module.exports = router;
