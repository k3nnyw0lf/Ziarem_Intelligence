const express = require('express');
const leadsRouter = require('./routes/leads');
const communicationsRouter = require('./routes/communications');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/leads', leadsRouter);
app.use('/communications', communicationsRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Ziarem API listening on port ${PORT}`);
});
