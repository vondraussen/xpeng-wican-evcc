const http = require('http');
const config = require('./config');
const state = require('./state');

// WiCAN's own /autopid_data endpoint only includes keys for PIDs that
// successfully returned data on the last poll cycle - silently omits
// failing ones. Keys we care about get mapped to the canonical signal
// names used by decoder.js / config.yaml; per-cell voltage/temp arrays
// (HV_C_V_001..192, HV_T_1..34) are skipped as noise (unreliable byte
// alignment observed in testing) but HV_C_V_MAX/MIN and HV_T_MAX/MIN are
// kept.
const KEY_MAP = {
  SOC: 'soc',
  SOH: 'soh',
  ODOMETER: 'odometer',
  HV_V: 'hv_voltage',
  HV_A: 'hv_current',
  RANGE: 'range',
  CHARGING: 'charging',
};

const SKIP_PATTERN = /^HV_C_V_\d+$|^HV_T_\d+$/;

function fetchOnce() {
  const req = http.get(config.wicanHttpUrl, { timeout: 5000 }, (res) => {
    let body = '';
    res.on('data', (chunk) => (body += chunk));
    res.on('end', () => {
      if (res.statusCode !== 200) {
        console.error(`[http-poll] ${config.wicanHttpUrl} returned ${res.statusCode}`);
        return;
      }
      try {
        const data = JSON.parse(body);
        let count = 0;
        for (const [key, value] of Object.entries(data)) {
          if (SKIP_PATTERN.test(key)) continue;
          if (typeof value !== 'number') continue;
          const mapped = KEY_MAP[key] || key.toLowerCase();
          state.setSignal(mapped, value);
          count++;
        }
        if (count > 0) state.markDeviceSeen();
      } catch (err) {
        console.error('[http-poll] failed to parse response:', err.message);
      }
    });
  });
  req.on('timeout', () => req.destroy());
  req.on('error', (err) => console.error('[http-poll] request error:', err.message));
}

function start() {
  if (!config.wicanHttpUrl) {
    console.log('[http-poll] WICAN_HTTP_URL not set, skipping (MQTT ingest only)');
    return;
  }
  console.log(`[http-poll] polling ${config.wicanHttpUrl} every ${config.wicanHttpPollMs}ms`);
  fetchOnce();
  setInterval(fetchOnce, config.wicanHttpPollMs);
}

module.exports = { start };
