const express = require('express');
const { pool } = require('../db');
const { sendVideoEmail } = require('../email_engine');

const router = express.Router();
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * GET /communications – all-in-one feed (all businesses), sorted by sent_at
 * Query: limit, offset, lead_id (optional filter)
 */
router.get('/', async (req, res) => {
  try {
    let limit = parseInt(req.query.limit, 10) || DEFAULT_LIMIT;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const leadId = req.query.lead_id ? parseInt(req.query.lead_id, 10) : null;

    let where = '';
    const params = [limit, offset];
    if (leadId != null && !Number.isNaN(leadId)) {
      where = 'WHERE c.lead_id = $3';
      params.push(leadId);
    }

    const sql = `
      SELECT c.id, c.lead_id, c.direction, c.subject, c.body_text, c.body_html, c.sent_at, c.business_id,
             b.business_name
      FROM communications c
      LEFT JOIN business_emails b ON b.id = c.business_id
      ${where}
      ORDER BY c.sent_at DESC
      LIMIT $1 OFFSET $2`;
    const result = await pool.query(sql, params);

    const countResult = await pool.query(
      leadId != null ? 'SELECT count(*)::int AS total FROM communications WHERE lead_id = $1' : 'SELECT count(*)::int AS total FROM communications',
      leadId != null ? [leadId] : []
    );
    const total = countResult.rows[0]?.total ?? 0;

    res.json({
      data: result.rows,
      pagination: { limit, offset, total, hasMore: offset + result.rows.length < total },
    });
  } catch (err) {
    console.error('GET /communications error:', err);
    res.status(500).json({ error: 'Failed to fetch communications' });
  }
});

/**
 * GET /communications/lead/:leadId – history for one client (for History tab)
 */
router.get('/lead/:leadId', async (req, res) => {
  try {
    const leadId = parseInt(req.params.leadId, 10);
    if (Number.isNaN(leadId)) return res.status(400).json({ error: 'Invalid lead_id' });

    const result = await pool.query(
      `SELECT c.id, c.lead_id, c.direction, c.subject, c.body_text, c.body_html, c.sent_at, c.business_id,
              b.business_name
       FROM communications c
       LEFT JOIN business_emails b ON b.id = c.business_id
       WHERE c.lead_id = $1
       ORDER BY c.sent_at DESC`,
      [leadId]
    );
    res.json({ data: result.rows });
  } catch (err) {
    console.error('GET /communications/lead/:leadId error:', err);
    res.status(500).json({ error: 'Failed to fetch lead history' });
  }
});

/**
 * GET /communications/:id – single email (reading pane)
 */
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const result = await pool.query(
      `SELECT c.id, c.lead_id, c.direction, c.subject, c.body_text, c.body_html, c.sent_at, c.business_id,
              b.business_name
       FROM communications c
       LEFT JOIN business_emails b ON b.id = c.business_id
       WHERE c.id = $1`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /communications/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch communication' });
  }
});

/**
 * POST /communications/send-video – send video email (Video Composer)
 * Body: { leadId, businessId, youtubeLink, message? }
 */
router.post('/send-video', async (req, res) => {
  try {
    const { leadId, businessId, youtubeLink, message } = req.body || {};
    if (leadId == null || businessId == null || !youtubeLink) {
      return res.status(400).json({ error: 'leadId, businessId, and youtubeLink are required' });
    }
    const result = await sendVideoEmail(Number(leadId), Number(businessId), youtubeLink, message || '');
    res.json({ success: true, to: result.to, subject: result.subject, sentAt: result.sentAt });
  } catch (err) {
    console.error('POST /communications/send-video error:', err);
    res.status(500).json({ error: err.message || 'Failed to send video email' });
  }
});

module.exports = router;
