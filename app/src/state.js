const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'data', 'state.json');

let signals = {};
let deviceLastSeen = null;
let lastStatus = null;
const rawFrames = [];

function load() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    signals = parsed.signals || {};
    deviceLastSeen = parsed.deviceLastSeen || null;
    lastStatus = parsed.lastStatus || null;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[state] failed to load persisted state:', err.message);
    }
  }
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({ signals, deviceLastSeen, lastStatus }, null, 2)
    );
  }, 500);
}

function setSignal(key, value, unit) {
  signals[key] = { value, unit, ts: Date.now() };
  persist();
}

function getSignal(key) {
  return signals[key] || null;
}

function getAllSignals() {
  return signals;
}

function markDeviceSeen() {
  deviceLastSeen = Date.now();
  persist();
}

function getDeviceLastSeen() {
  return deviceLastSeen;
}

function setLastStatus(status) {
  lastStatus = status;
  persist();
}

function getLastStatus() {
  return lastStatus;
}

function pushRawFrame(frame, bufferSize) {
  rawFrames.push({ ...frame, receivedAt: Date.now() });
  while (rawFrames.length > bufferSize) rawFrames.shift();
}

function getRawFrames() {
  return rawFrames;
}

load();

module.exports = {
  setSignal,
  getSignal,
  getAllSignals,
  markDeviceSeen,
  getDeviceLastSeen,
  setLastStatus,
  getLastStatus,
  pushRawFrame,
  getRawFrames,
};
