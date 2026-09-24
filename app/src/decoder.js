const config = require('./config');
const { state, save } = require('./state');

function fresh(sig) {
  if (!sig) return false;
  return Date.now() - sig.ts <= config.signalStaleMs;
}

// Derives an evcc-compatible view of vehicle state from whatever raw
// signals have arrived so far.
function getVehicleState() {
  const { soc, soh, hv_v: hvVoltage, hv_a: hvCurrent, odometer, charging } = state.signals;

  let chargePowerKw = null;
  if (fresh(hvVoltage) && fresh(hvCurrent)) {
    chargePowerKw = (hvVoltage.value * hvCurrent.value) / 1000;
  }

  // IEC 61851 status heuristic with a hold window over WiCAN sleep/reboot
  // blips - see README "Charging-status caveat".
  const deviceOnline =
    state.deviceLastSeen && Date.now() - state.deviceLastSeen <= config.signalStaleMs;

  let status;
  let statusHeld = false;
  if (fresh(charging)) {
    status = charging.value ? 'C' : 'B';
  } else if (chargePowerKw !== null && Math.abs(chargePowerKw) > config.chargingPowerThresholdKw) {
    status = 'C';
  } else if (deviceOnline) {
    status = 'B';
  } else if (Date.now() - state.deviceLastSeen <= config.statusHoldMs && state.lastStatus) {
    status = state.lastStatus;
    statusHeld = true;
  } else {
    status = 'A';
  }
  if (status !== state.lastStatus) {
    state.lastStatus = status;
    save();
  }

  // soc/soh/odometer/range hold their last value forever: the WiCAN sleeps
  // for hours and evcc can't parse null. hv*/chargePowerKw are never held,
  // a stale reading would misreport charging.
  return {
    soc: soc?.value ?? null,
    soh: soh?.value ?? null,
    hvVoltage: fresh(hvVoltage) ? hvVoltage.value : null,
    hvCurrent: fresh(hvCurrent) ? hvCurrent.value : null,
    chargePowerKw: chargePowerKw !== null ? Number(chargePowerKw.toFixed(2)) : null,
    odometerKm: odometer?.value ?? null,
    // Matches the car's WLTP range display (SOC x rated range), not "dynamic".
    // ponytail: ignores SOH; multiply by soh/100 if it drifts once SOH < 100%.
    rangeKm: soc ? Math.round((soc.value * config.wltpRangeKm) / 100) : null,
    status,
    statusHeld,
    dataHeld: !deviceOnline,
    deviceOnline: Boolean(deviceOnline),
    deviceLastSeen: state.deviceLastSeen,
    updatedAt: Date.now(),
  };
}

module.exports = { getVehicleState };
