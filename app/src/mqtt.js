const mqtt = require('mqtt');
const config = require('./config');
const state = require('./state');

function parsePayload(buf) {
  const text = buf.toString('utf8').trim();
  // AutoPID/vehicle-profile signals are observed in the wild as bare
  // numbers (e.g. "76"), but decode JSON too in case a payload is wrapped.
  if (text === '') return null;
  const asNumber = Number(text);
  if (!Number.isNaN(asNumber) && /^-?[\d.]+$/.test(text)) return asNumber;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && 'value' in parsed) {
      return parsed.value;
    }
    return parsed;
  } catch {
    return text;
  }
}

function start() {
  const client = mqtt.connect(config.mqtt.url, {
    username: config.mqtt.username,
    password: config.mqtt.password,
    reconnectPeriod: 2000,
    clientId: `xpeng-wican-evcc-${Math.random().toString(16).slice(2, 8)}`,
  });

  const rawTopic = `wican/${config.deviceId}/can/rx`;
  const statusTopic = `wican/${config.deviceId}/can/status`;
  const signalTopic = `${config.signalTopicPrefix}/#`;

  client.on('connect', () => {
    console.log(`[mqtt] connected to ${config.mqtt.url}`);
    for (const topic of [rawTopic, statusTopic, signalTopic]) {
      client.subscribe(topic, (err) => {
        if (err) console.error(`[mqtt] failed to subscribe ${topic}:`, err.message);
        else console.log(`[mqtt] subscribed ${topic}`);
      });
    }
  });

  client.on('reconnect', () => console.log('[mqtt] reconnecting...'));
  client.on('error', (err) => console.error('[mqtt] error:', err.message));

  client.on('message', (topic, payload) => {
    if (topic.endsWith('/can/rx')) {
      state.markDeviceSeen();
      try {
        const data = JSON.parse(payload.toString('utf8'));
        state.pushRawFrame({ topic, ...data }, config.rawFrameBufferSize);
      } catch {
        state.pushRawFrame({ topic, raw: payload.toString('utf8') }, config.rawFrameBufferSize);
      }
      return;
    }

    if (topic.endsWith('/status') && topic.startsWith('wican/')) {
      // WiCAN publishes {"status":"online"|"offline"} here - "offline" is
      // announced right as the device goes to sleep (see README "WiCAN
      // going offline vs. the car unplugging"). Only "online" counts as a
      // sighting; treating "offline" as a sighting was defeating the
      // staleness/hold logic by keeping deviceLastSeen artificially fresh
      // at exactly the moment the device said it was going away.
      try {
        const data = JSON.parse(payload.toString('utf8'));
        if (data && String(data.status).toLowerCase() === 'online') {
          state.markDeviceSeen();
        }
      } catch {
        // non-JSON payload on this topic - ignore rather than guess
      }
      return;
    }

    if (topic.startsWith(`${config.signalTopicPrefix}/`)) {
      state.markDeviceSeen();
      const key = topic.slice(config.signalTopicPrefix.length + 1);
      const mapping = config.signals[key];
      const value = parsePayload(payload);
      if (value === null) return;
      state.setSignal(key, value, mapping ? mapping.unit : undefined);
    }
  });

  return client;
}

module.exports = { start };
