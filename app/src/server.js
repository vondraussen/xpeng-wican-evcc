const http = require('http');
const config = require('./config');
const httpPoll = require('./httpPoll');
const { getVehicleState } = require('./decoder');
const { state } = require('./state');

httpPoll.start();

const routes = {
  '/api/vehicle': getVehicleState,
  // Every signal as ingested, with its last-updated timestamp - use this to
  // spot new keys worth mapping (see README "Finding more signals").
  '/api/debug/signals': () => state.signals,
};

http
  .createServer((req, res) => {
    const route = routes[req.url];
    res.writeHead(route ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(route ? route() : { error: 'not found' }));
  })
  .listen(config.httpPort, () => {
    console.log(`[http] xpeng-wican-evcc listening on :${config.httpPort}`);
  });
