const express = require('express');
const cors = require('cors');
const path = require('path');
const { pool } = require('./db');
const { apiKeyAuth } = require('./middleware/auth');
const rateLimiter = require('./middleware/rateLimit');
const swaggerUi = require('swagger-ui-express');
const leadsRouter = require('./routes/leads');
const communicationsRouter = require('./routes/communications');
const businessesRouter = require('./routes/businesses');
const integrationsRouter = require('./routes/integrations');
const trackingRouter = require('./routes/tracking');
const campaignsRouter = require('./routes/campaigns');
const smtpIdentitiesRouter = require('./routes/smtpIdentities');
const inboxRouter = require('./routes/inbox');

const app = express();
const PORT = process.env.PORT || 3000;

const openapiSpec = require('../docs/openapi.json');

// Serve the built SPA (CRM frontend) BEFORE the API auth gate so / and /assets bypass apiKeyAuth.
// dist/ is committed so the Passenger deploy needs no build step.
app.use(express.static(path.join(__dirname, '..', 'dist')));

app.use(cors({ origin: true, credentials: true }));
app.use(rateLimiter);
app.use(express.json());

app.use((req, res, next) => {
  const p = req.path || req.url?.split('?')[0] || '';
  if (p === '/health' || p === '/docs' || p.startsWith('/api/track')) return next();
  apiKeyAuth(req, res, next);
});

app.use('/leads', leadsRouter);
app.use('/communications', communicationsRouter);
app.use('/businesses', businessesRouter);
app.use('/integrations', integrationsRouter);
app.use('/api', trackingRouter);
app.use('/campaigns', campaignsRouter);
app.use('/smtp-identities', smtpIdentitiesRouter);
app.use('/inbox', inboxRouter);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'disconnected', error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Ziarem API listening on port ${PORT}`);
});
