# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A small Node.js (CommonJS, no dependencies) service that reads XPeng G6 telemetry from a WiCAN OBD/CAN gateway and exposes it as an HTTP API for evcc. All code lives in `app/`. `README.md` has the deployment history, the WiCAN firmware quirks and the evcc config. Read it before changing ingest or status logic.

## Commands

```bash
cd app
npm start                          # node --env-file=.env src/server.js, listens on HTTP_PORT (default 8080)
curl localhost:8080/api/vehicle    # decoded view
curl localhost:8080/api/debug/signals
```

There are no tests, linter or build step. In production it runs as the systemd service `xpeng-wican-evcc`. After changing code or config, restart it with `systemctl restart xpeng-wican-evcc`, and view logs with `journalctl -u xpeng-wican-evcc -f`.

All config is environment variables, read in `src/config.js`. They come from `app/.env` (git-ignored; copy from `.env.example`), which systemd loads via `EnvironmentFile=` and `npm start` via `--env-file`. There are no dependencies: the HTTP server is plain `node:http`.

## Architecture

Data flows **ingest → `state` → `decoder` → routes**:

- **`src/httpPoll.js`** is the only ingest path. It `fetch`es WiCAN's `/autopid_data` JSON. WiCAN keys are stored lowercased (`SOC` → `soc`, `HV_V` → `hv_v`). Per-cell `HV_C_V_nnn` / `HV_T_n` keys are skipped on purpose because their data is garbled. MQTT ingest was removed; the WiCAN's MQTT `Send_to` never worked on this firmware.
- **`src/state.js`** exports a plain `state` object (`signals: {key: {value, ts}}`, `deviceLastSeen`, `lastStatus`) and `save()`. Mutate the object directly, then call `save()`, which writes `app/data/state.json` so values survive restarts.
- **`src/decoder.js`** is where the domain logic lives. `getVehicleState()` builds the evcc view on every request, and nothing is cached. It hard-codes the canonical keys (`soc`, `soh`, `hv_v`, `hv_a`, `odometer`, `range`, `charging`). A new signal therefore only needs a field in `decoder.js`, read under its lowercased WiCAN key.

  evcc reads everything from `GET /api/vehicle` with `jq`, so there are no per-field routes. The routes are defined in `src/server.js`.

## Status and hold semantics (easy to break)

`status` follows the IEC 61851 letters evcc expects: `A` = disconnected, `B` = connected, `C` = charging. Because no plug-state PID is confirmed for the G6, it's a heuristic applied in priority order:

1. A fresh `charging` signal.
2. `|hvVoltage × hvCurrent| / 1000` above `CHARGING_POWER_THRESHOLD_KW`, which gives `C`.
3. The device is online, which gives `B`.
4. The device went offline but is still inside the `STATUS_HOLD_MS` window, which returns the last known status (`statusHeld: true`).
5. Otherwise `A`.

The WiCAN sleeps and reboots regularly to protect the 12V battery. The hold window exists so those sleep cycles aren't reported to evcc as the car being unplugged. Keep these distinctions intact:
- `deviceOnline` reflects the raw transport and uses the `SIGNAL_STALE_MS` threshold. `status` holds its value for the longer `STATUS_HOLD_MS`.
- `soc`, `soh`, `odometerKm` and `rangeKm` always return their last known value, with no time limit, and are `null` only if never seen. evcc fails on `null` (`parsing "<nil>"`), and the WiCAN can sleep for hours. `dataHeld: true` means the device is offline.
- `hvVoltage`, `hvCurrent` and `chargePowerKw` are **never** held. A stale electrical reading could misreport whether the car is charging.
- Don't hard-code `status` to `B`/`C`. evcc relies on `A` to detect that the car has actually left.
