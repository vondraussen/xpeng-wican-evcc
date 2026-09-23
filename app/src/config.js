const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
require('dotenv').config();

const yamlPath = path.join(__dirname, '..', 'config.yaml');
const fileConfig = yaml.load(fs.readFileSync(yamlPath, 'utf8'));

module.exports = {
  mqtt: {
    url: process.env.MQTT_URL || 'mqtt://mosquitto:1883',
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
  },
  deviceId: process.env.WICAN_DEVICE_ID || '+',
  signalTopicPrefix: process.env.SIGNAL_TOPIC_PREFIX || 'xpeng',
  wicanHttpUrl: process.env.WICAN_HTTP_URL || '',
  wicanHttpPollMs: parseInt(process.env.WICAN_HTTP_POLL_MS || '10000', 10),
  rawFrameBufferSize: parseInt(process.env.RAW_FRAME_BUFFER_SIZE || '200', 10),
  signalStaleMs: parseInt(process.env.SIGNAL_STALE_MS || '120000', 10),
  statusHoldMs: parseInt(process.env.STATUS_HOLD_MS || '900000', 10),
  httpPort: parseInt(process.env.HTTP_PORT || '8080', 10),
  signals: fileConfig.signals || {},
  chargingPowerThresholdKw: fileConfig.chargingPowerThresholdKw ?? 0.2,
  batteryCapacityKwh: fileConfig.batteryCapacityKwh ?? null,
};
