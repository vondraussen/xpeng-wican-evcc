const express = require('express');
const decoder = require('../decoder');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(decoder.getVehicleState());
});

router.get('/soc', (req, res) => {
  res.json({ soc: decoder.getVehicleState().soc });
});

router.get('/status', (req, res) => {
  res.json({ status: decoder.getVehicleState().status });
});

router.get('/range', (req, res) => {
  res.json({ rangeKm: decoder.getVehicleState().rangeKm });
});

router.get('/odometer', (req, res) => {
  res.json({ odometerKm: decoder.getVehicleState().odometerKm });
});

router.get('/power', (req, res) => {
  res.json({ chargePowerKw: decoder.getVehicleState().chargePowerKw });
});

module.exports = router;
