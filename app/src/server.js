const express = require('express');
const config = require('./config');
const httpPoll = require('./httpPoll');
const { getVehicleState } = require('./decoder');
const { state } = require('./state');

httpPoll.start();

const app = express();

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.get('/api/vehicle', (req, res) => res.json(getVehicleState()));
// Every signal as ingested, with its last-updated timestamp - use this to
// spot new keys worth mapping (see README "Finding more signals").
app.get('/api/debug/signals', (req, res) => res.json(state.signals));

app.listen(config.httpPort, () => {
  console.log(`[http] xpeng-wican-evcc listening on :${config.httpPort}`);
});
