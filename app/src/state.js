const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'data', 'state.json');

// signals: { <key>: { value, ts } }. Persisted so a restart doesn't blank
// evcc while the WiCAN is asleep.
const state = { signals: {}, deviceLastSeen: null, lastStatus: null };

try {
  Object.assign(state, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
} catch (err) {
  if (err.code !== 'ENOENT') {
    console.error('[state] failed to load persisted state:', err.message);
  }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }, 500);
}

module.exports = { state, save };
