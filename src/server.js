const express = require('express');
const cors = require('cors');
const leadsRouter = require('./routes/leads');
const communicationsRouter = require('./routes/communications');
const businessesRouter = require('./routes/businesses');
const integrationsRouter = require('./routes/integrations');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use('/leads', leadsRouter);
app.use('/communications', communicationsRouter);
app.use('/businesses', businessesRouter);
app.use('/integrations', integrationsRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Ziarem API listening on port ${PORT}`);
});
