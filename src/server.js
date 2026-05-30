// Ziarem CRM — static frontend server (Passenger entry).
// The CRM frontend is a Vite SPA that talks to Supabase directly, so all it
// needs is static file serving. The former API server is preserved in
// src/server.api.js.bak (its express/cors/pg/etc. deps were never declared,
// which left Passenger returning 503). Revive it later as a separate service.
const express = require('express');
const path = require('path');

const app = express();
const DIST = path.join(__dirname, '..', 'dist');

app.use(express.static(DIST, { index: 'index.html', extensions: ['html'] }));

// SPA fallback — the CRM is state-routed, but serve index.html for any
// non-file path so deep links / refreshes still load the app.
app.get('*', (req, res) => {
  res.sendFile(path.join(DIST, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Ziarem CRM (static) listening on ${PORT}`));
