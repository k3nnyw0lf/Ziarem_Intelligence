/**
 * GET /integrations – list which free APIs are configured (for UI/docs).
 * No secrets returned; only whether each integration is available.
 */
const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    integrations: [
      {
        id: 'geocode',
        name: 'Nominatim (OpenStreetMap)',
        description: 'Address → lat/lon',
        free: true,
        keyRequired: false,
        enabled: true,
        rateLimit: '1 request/second',
      },
      {
        id: 'email_validation',
        name: 'Abstract API – Email Validation',
        description: 'Email deliverability & format',
        free: true,
        keyRequired: true,
        enabled: Boolean(process.env.ABSTRACT_EMAIL_API_KEY),
        rateLimit: '100/month free',
      },
      {
        id: 'phone_validation',
        name: 'Abstract API or NumVerify – Phone Validation',
        description: 'Phone validity, carrier, location',
        free: true,
        keyRequired: true,
        enabled: Boolean(process.env.ABSTRACT_PHONE_API_KEY || process.env.NUMVERIFY_API_KEY),
        rateLimit: 'Abstract 100/month, NumVerify 250/month free',
      },
      {
        id: 'ip_geo',
        name: 'ip-api.com',
        description: 'IP → country, city, lat/lon, ISP',
        free: true,
        keyRequired: false,
        enabled: true,
        rateLimit: '45 requests/minute',
      },
    ],
    enrichEndpoint: 'GET /leads/:id/enrich',
  });
});

module.exports = router;
