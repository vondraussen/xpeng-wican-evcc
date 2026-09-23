const config = require('./config');
const { state, save } = require('./state');

// WiCAN's own /autopid_data endpoint only includes keys for PIDs that
// successfully returned data on the last poll cycle - silently omits
// failing ones. Keys we care about get mapped to the canonical signal
// names used by decoder.js; per-cell voltage/temp arrays
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

async function fetchOnce() {
  try {
    const res = await fetch(config.wicanHttpUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`returned ${res.status}`);
    const data = await res.json();
    let count = 0;
    for (const [key, value] of Object.entries(data)) {
      if (SKIP_PATTERN.test(key) || typeof value !== 'number') continue;
      state.signals[KEY_MAP[key] || key.toLowerCase()] = { value, ts: Date.now() };
      count++;
    }
    if (count > 0) {
      state.deviceLastSeen = Date.now();
      save();
    }
  } catch (err) {
    console.error(`[http-poll] ${config.wicanHttpUrl}:`, err.cause?.code || err.message);
  }
}

function start() {
  if (!config.wicanHttpUrl) {
    console.error('[http-poll] WICAN_HTTP_URL is not set');
    process.exit(1);
  }
  console.log(`[http-poll] polling ${config.wicanHttpUrl} every ${config.wicanHttpPollMs}ms`);
  fetchOnce();
  setInterval(fetchOnce, config.wicanHttpPollMs);
}

module.exports = { start };
