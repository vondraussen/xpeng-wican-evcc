const config = require('./config');
const { state, save } = require('./state');

// WiCAN's /autopid_data only includes keys for PIDs that answered on the
// last cycle. Keys are stored lowercased (SOC -> soc, HV_V -> hv_v).
// Per-cell HV_C_V_001..192 / HV_T_1..34 are skipped (unreliable byte
// alignment); HV_C_V_MAX/MIN and HV_T_MAX/MIN are kept.
const SKIP_PATTERN = /^HV_C_V_\d+$|^HV_T_\d+$/;

async function fetchOnce() {
  try {
    const res = await fetch(config.wicanHttpUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`returned ${res.status}`);
    const data = await res.json();
    let count = 0;
    for (const [key, value] of Object.entries(data)) {
      if (SKIP_PATTERN.test(key) || typeof value !== 'number') continue;
      state.signals[key.toLowerCase()] = { value, ts: Date.now() };
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
