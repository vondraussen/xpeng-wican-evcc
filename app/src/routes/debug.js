const express = require('express');
const state = require('../state');

const router = express.Router();

// Raw CAN frames as received on wican/<id>/can/rx - use this to reverse
// engineer additional XPeng G6 PIDs (watch frame ids/data change while
// charging/driving and correlate against the dash).
router.get('/frames', (req, res) => {
  res.json(state.getRawFrames());
});

// All named signals ingested from the AutoPID/vehicle-profile MQTT topics,
// with raw value/unit/last-updated timestamp per signal.
router.get('/signals', (req, res) => {
  res.json(state.getAllSignals());
});

module.exports = router;
