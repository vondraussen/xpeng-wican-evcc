const config = require('./config');
const { state, save } = require('./state');

function fresh(sig) {
  if (!sig) return false;
  return Date.now() - sig.ts <= config.signalStaleMs;
}

// Derives an evcc-compatible view of vehicle state from whatever raw
// signals have arrived so far. Fields are null when we don't have (fresh)
// data rather than guessing.
function getVehicleState() {
  const {
    soc,
    soh,
    hv_voltage: hvVoltage,
    hv_current: hvCurrent,
    odometer,
    range,
    charging: chargingRaw,
  } = state.signals;

  let chargePowerKw = null;
  if (fresh(hvVoltage) && fresh(hvCurrent)) {
    chargePowerKw = (hvVoltage.value * hvCurrent.value) / 1000;
  }

  // Status per evcc/IEC 61851 convention: A=disconnected, B=connected, C=charging
  // This is a best-effort heuristic in the absence of a confirmed plug-state
  // PID for the G6 - see README "Charging status caveat".
  //
  // `deviceOnline` reflects the raw transport (did WiCAN answer recently) and
  // is exposed as-is for monitoring/debug. But the WiCAN drops offline for
  // brief stretches on its own (reboots, wifi blips) that have nothing to do
  // with the car being unplugged - since evcc treats A/B/C as ground truth
  // for whether a session is active, flapping straight to 'A' on every such
  // blip creates a false "car disconnected" event. So the evcc-facing
  // `status` instead holds the last known B/C for `statusHoldMs` after the
  // device goes quiet, and only falls back to 'A' once that's been exceeded
  // (real "the car left" case) - see README "Charging-status caveat".
  const deviceOnline =
    state.deviceLastSeen && Date.now() - state.deviceLastSeen <= config.signalStaleMs;

  // Slow-changing signals (soc, soh, odometer, range) always report their
  // last known value, however old, rather than going null. The WiCAN
  // sleeps for hours at a time while the car is parked (see README "Why the
  // WiCAN goes offline at all"), and these don't change while it's asleep.
  // evcc can't parse null ("strconv.ParseFloat: parsing \"<nil>\""), which
  // failed vehicle validation whenever the device happened to be asleep.
  // They only return null if the signal has never been seen at all.
  //
  // Deliberately NOT applied to hvVoltage/hvCurrent/chargePowerKw - those
  // are instantaneous electrical readings where a stale value could
  // actively misrepresent whether charging is still happening.
  const lastSeen = state.deviceLastSeen;
  const withinHoldWindow = !deviceOnline && lastSeen && Date.now() - lastSeen <= config.statusHoldMs;

  function lastKnown(sig) {
    return sig ? sig.value : null;
  }

  let status;
  let statusHeld = false;
  if (fresh(chargingRaw)) {
    status = chargingRaw.value ? 'C' : 'B';
  } else if (chargePowerKw !== null && Math.abs(chargePowerKw) > config.chargingPowerThresholdKw) {
    status = 'C';
  } else if (deviceOnline) {
    status = 'B';
  } else if (withinHoldWindow && state.lastStatus) {
    status = state.lastStatus;
    statusHeld = true;
  } else {
    status = 'A';
  }
  if (status !== state.lastStatus) {
    state.lastStatus = status;
    save();
  }

  return {
    soc: lastKnown(soc),
    soh: lastKnown(soh),
    hvVoltage: fresh(hvVoltage) ? hvVoltage.value : null,
    hvCurrent: fresh(hvCurrent) ? hvCurrent.value : null,
    chargePowerKw: chargePowerKw !== null ? Number(chargePowerKw.toFixed(2)) : null,
    odometerKm: lastKnown(odometer),
    rangeKm: lastKnown(range),
    status,
    statusHeld,
    dataHeld: !deviceOnline,
    deviceOnline: Boolean(deviceOnline),
    deviceLastSeen: state.deviceLastSeen,
    updatedAt: Date.now(),
  };
}

module.exports = { getVehicleState };
