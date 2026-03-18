const express = require('express');
const { pool } = require('../db');
const { BUSINESSES } = require('../../config/businesses');

const router = express.Router();

/**
 * GET /businesses
 * Returns all Ziarem businesses and services (name, badge, description, ziarem_tags, services).
 * If business_emails has rows, each business is merged with matching business_id by name so
 * the inbox can use business_id for send/receive.
 */
router.get('/', async (req, res) => {
  try {
    let emails = [];
    try {
      const r = await pool.query('SELECT id, business_name FROM business_emails ORDER BY id');
      emails = r.rows;
    } catch (_) {
      // table may not exist or not migrated yet
    }

    const byName = new Map(emails.map((e) => [e.business_name.toLowerCase().trim(), e.id]));

    const list = BUSINESSES.map((b) => ({
      ...b,
      business_id: byName.get(b.name.toLowerCase()) ?? byName.get(b.badge.toLowerCase()) ?? null,
    }));

    res.json({ data: list });
  } catch (err) {
    console.error('GET /businesses error:', err);
    res.status(500).json({ error: 'Failed to fetch businesses' });
  }
});

module.exports = router;
