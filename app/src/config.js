module.exports = {
  wicanHttpUrl: process.env.WICAN_HTTP_URL || '',
  wicanHttpPollMs: parseInt(process.env.WICAN_HTTP_POLL_MS || '10000', 10),
  signalStaleMs: parseInt(process.env.SIGNAL_STALE_MS || '120000', 10),
  statusHoldMs: parseInt(process.env.STATUS_HOLD_MS || '900000', 10),
  chargingPowerThresholdKw: parseFloat(process.env.CHARGING_POWER_THRESHOLD_KW || '0.2'),
  wltpRangeKm: parseFloat(process.env.WLTP_RANGE_KM || '510'),
  httpPort: parseInt(process.env.HTTP_PORT || '8080', 10),
};
