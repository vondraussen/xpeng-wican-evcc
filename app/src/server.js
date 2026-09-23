const express = require('express');
const config = require('./config');
const mqttClient = require('./mqtt');
const httpPoll = require('./httpPoll');
const vehicleRoutes = require('./routes/vehicle');
const debugRoutes = require('./routes/debug');

mqttClient.start();
httpPoll.start();

const app = express();

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use('/api/vehicle', vehicleRoutes);
app.use('/api/debug', debugRoutes);

app.listen(config.httpPort, () => {
  console.log(`[http] xpeng-wican-evcc listening on :${config.httpPort}`);
});
