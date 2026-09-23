# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A small Node.js (CommonJS, Express) service that reads XPeng G6 telemetry from a WiCAN OBD/CAN gateway and exposes it as an HTTP API for evcc. All code lives in `app/`. `README.md` has the deployment history, the WiCAN firmware quirks and the evcc config. Read it before changing ingest or status logic.

## Commands

```bash
cd app
npm install
npm start                          # node src/server.js, listens on HTTP_PORT (default 8080)
curl localhost:8080/api/vehicle    # decoded view
curl localhost:8080/api/debug/signals
```

There are no tests, linter or build step. In production it runs as the systemd service `xpeng-wican-evcc`. After changing code or config, restart it with `systemctl restart xpeng-wican-evcc`, and view logs with `journalctl -u xpeng-wican-evcc -f`.

Config comes from two places, both loaded by `src/config.js`:
- `app/.env` (git-ignored; copy from `.env.example`) holds connection settings and timing values.
- `app/config.yaml` holds the MQTT signal units, `chargingPowerThresholdKw` and `batteryCapacityKwh`.

## Architecture

Data flows **ingest → `state` → `decoder` → routes**:

- **Two ingest paths feed a single signal store.** Both write via `state.setSignal(key, value)` and call `state.markDeviceSeen()`.
  - `src/httpPoll.js` is the primary path. It polls WiCAN's `/autopid_data` JSON. `KEY_MAP` converts WiCAN keys (`SOC`, `HV_A`, …) to canonical snake_case keys. Keys not in the map are stored lowercased. Per-cell `HV_C_V_nnn` / `HV_T_n` keys are skipped on purpose because their data is garbled.
  - `src/mqtt.js` is optional and still wired up. It handles `<SIGNAL_TOPIC_PREFIX>/<key>` signals, raw frames from `wican/<id>/can/rx` (these go to a ring buffer for `/api/debug/frames`), and `wican/<id>/can/status`. On the status topic, only an explicit `"online"` payload counts as a sighting. WiCAN publishes `"offline"` as it goes to sleep, and treating that as a sighting breaks the hold logic.
- **`src/state.js`** is an in-memory singleton that stores `{value, unit, ts}` for each signal, plus `deviceLastSeen` and `lastStatus`. Every write is debounced to `app/data/state.json` so values survive restarts.
- **`src/decoder.js`** is where the domain logic lives. `getVehicleState()` builds the evcc view on every request, and nothing is cached. It hard-codes the canonical keys (`soc`, `soh`, `hv_voltage`, `hv_current`, `odometer`, `range`, `charging`). A new signal therefore needs:
  - a `KEY_MAP` entry in `httpPoll.js`,
  - a field in `decoder.js`,
  - and, if evcc should read it, a route in `routes/vehicle.js`.

  The `field:` names in `config.yaml` aren't read anywhere. The code only uses `unit`, and only on the MQTT path.

## Status and hold semantics (easy to break)

`status` follows the IEC 61851 letters evcc expects: `A` = disconnected, `B` = connected, `C` = charging. Because no plug-state PID is confirmed for the G6, it's a heuristic applied in priority order:

1. A fresh `charging` signal.
2. `|hvVoltage × hvCurrent| / 1000` above `chargingPowerThresholdKw`, which gives `C`.
3. The device is online, which gives `B`.
4. The device went offline but is still inside the `STATUS_HOLD_MS` window, which returns the last known status (`statusHeld: true`).
5. Otherwise `A`.

The WiCAN sleeps and reboots regularly to protect the 12V battery. The hold window exists so those sleep cycles aren't reported to evcc as the car being unplugged. Keep these distinctions intact:
- `deviceOnline` reflects the raw transport and uses the `SIGNAL_STALE_MS` threshold. `status` holds its value for the longer `STATUS_HOLD_MS`.
- `soc`, `soh`, `odometerKm` and `rangeKm` always return their last known value, with no time limit, and are `null` only if never seen. evcc fails on `null` (`parsing "<nil>"`), and the WiCAN can sleep for hours. `dataHeld: true` means the device is offline.
- `hvVoltage`, `hvCurrent` and `chargePowerKw` are **never** held. A stale electrical reading could misreport whether the car is charging.
- Don't hard-code `status` to `B`/`C`. evcc relies on `A` to detect that the car has actually left.
