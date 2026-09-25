# xpeng-wican-evcc

<img width="408" height="906" alt="image" src="https://github.com/user-attachments/assets/a983ec1c-b803-4726-aeab-872b020b1e13" />
<img width="408" height="906" alt="image" src="https://github.com/user-attachments/assets/d9845844-efea-4aaa-b973-8e62621d4a39" />


Reads vehicle telemetry from a WiCAN CAN-bus/OBD gateway (connected to an
XPeng G6), decodes it, and exposes it as a small HTTP API that evcc (or
anything else) can poll for SoC, charging status, range, etc.

```
XPeng G6 --CAN bus--> WiCAN --HTTP poll--> gateway (this app) --HTTP--> evcc
```

## Status: deployed and running, real data flowing

Runs as a systemd service (`xpeng-wican-evcc`).

```bash
systemctl status xpeng-wican-evcc   # check it's up
journalctl -u xpeng-wican-evcc -f   # tail logs
curl http://localhost:8080/api/vehicle
```

Confirmed working end-to-end against a real car.

Code lives in `app/`, config in `app/.env` (copy from `app/.env.example`),
service unit at `/etc/systemd/system/xpeng-wican-evcc.service`.
To change config: edit `.env`, then `systemctl restart xpeng-wican-evcc`.

## How it actually gets data (read this before touching WiCAN's UI)

The original plan was MQTT: configure WiCAN's Automate tab to publish each
PID to an MQTT topic (`Send_to`). That turned out to be a dead end on this
device/firmware (**v4.51p**):

- The built-in `Xpeng: P5/P7/G6/G9/X9` vehicle profile's SOC PID has a real,
  reported firmware bug (missing ECU priming step before the BMS diagnostic
  session — see
  [meatpiHQ/wican-fw#371](https://github.com/meatpiHQ/wican-fw/issues/371)).
- The Automate tab's **"Test"** button and the **Terminal** tool both turned
  out to be unreliable/non-functional on this device — the Terminal didn't
  even respond to a purely local `ATZ` command, which never touches the
  car. Don't trust either as a diagnostic signal.
- Despite both showing errors, the underlying background AutoPID polling
  loop **is actually working** — confirmed via WiCAN's own
  `http://<wican-ip>/autopid_data` endpoint, which returns live,
  correct JSON (SOC, ODOMETER, HV current, pack temps, cell voltages) even
  while the Automate UI showed "Error: No response" next to those same
  PIDs.

So: **this gateway polls that endpoint directly over HTTP** instead of
waiting for WiCAN to push over MQTT. No `Send_to` topic configuration
and no MQTT broker needed at all.

Config in `app/.env`:
```
WICAN_HTTP_URL=http://<wican-ip>/autopid_data
WICAN_HTTP_POLL_MS=10000
```
(`<wican-ip>` is your WiCAN unit's IP — set a DHCP reservation for it on
your router so it doesn't change.)

## 1. What's actually being read right now

WiCAN's `Xpeng: P5/P7/G6/G9/X9` profile (Automate tab → Vehicle Specific
PIDs → enabled) is active with this init string (already includes the ECU
priming fix):
```
ATH1;ATSP6;ATS0;ATM0;ATAT1;ATSH7E0;ATSH704;ATCRA784;ATFCSH704;ATFCSM1;
```

`/autopid_data` keys currently coming through and how this gateway maps
them (see `app/src/httpPoll.js`):

| WiCAN key | Mapped to | Status |
|---|---|---|
| `SOC` | `soc` (%) | ✅ working |
| `ODOMETER` | `odometerKm` | ✅ working |
| `HV_A` | `hvCurrent` (A) | ✅ working |
| `HV_T_MAX` / `HV_T_MIN` | `hv_t_max` / `hv_t_min` (raw, not in decoded view) | ✅ working |
| `HV_C_V_MAX` / `HV_C_V_MIN` | `hv_c_v_max` / `hv_c_v_min` (raw) | ✅ working |
| `HV_V` (pack voltage) | `hvVoltage` | ❌ not currently present in the response — PID not returning data |
| `SOH` | `soh` | ❌ not currently present |
| — (computed) | `rangeKm` | ✅ `SOC × WLTP_RANGE_KM / 100` (default 510), matches the car's WLTP range display (428 km at 84.0%). No range PID matches any display: BMS `221118` reads ~12% below WLTP, "dynamic" range is computed in the head unit. VCU `220313` ("RANGE_EST" in [xpcardata](https://github.com/stevelea/xpcardata/blob/main/docs/XPENG_G6_PIDs.md)) is **not** range on this car. SOH is ignored for now |
| per-cell `HV_C_V_001..192` / `HV_T_1..34` | — (skipped) | ⚠️ present but garbled (bad byte alignment), ignored on purpose |

`chargePowerKw` stays `null` until `HV_V` starts returning data (needs
both voltage and current to compute). If you want pack voltage, check
whether that PID row (`221101` upstream / `2211011` in the shipped
profile) is enabled in the Automate tab — it may just need enabling, or
may hit the same kind of intermittent failure as the per-cell arrays.

## 2. Verify data

```bash
curl http://<gateway-host>:8080/api/vehicle          # decoded/combined view
curl http://<gateway-host>:8080/api/debug/signals     # raw signals as ingested, with per-signal timestamps
curl http://<wican-ip>/autopid_data                # WiCAN's own raw endpoint, for comparison
```

`api/vehicle` currently returns something like:

```json
{
  "soc": 89.9,
  "soh": null,
  "hvVoltage": null,
  "hvCurrent": -9,
  "chargePowerKw": null,
  "odometerKm": 2792,
  "rangeKm": null,
  "status": "B",
  "deviceOnline": true,
  "deviceLastSeen": 1737100000000,
  "updatedAt": 1737100000123
}
```

## 3. Wire up evcc

evcc supports a `type: custom` vehicle backed by HTTP plugins. Copy
[`evcc.example.yaml`](evcc.example.yaml) into your evcc config, replace
`<gateway-host>`, and set `capacity` to your trim's usable kWh.

## Charging-status caveat

No plug/charging-status PID is confirmed working for the G6 yet, so
`status` is a heuristic (`app/src/decoder.js`):
1. If you've wired up an explicit `charging` signal, that wins.
2. Otherwise, if `hvVoltage * hvCurrent` exceeds
   `CHARGING_POWER_THRESHOLD_KW` (default 0.2 kW), reports `"C"` — currently
   inactive since `hvVoltage` isn't available yet (see table above).
3. Otherwise `"B"` whenever the WiCAN is online/reachable, else `"A"`.

Practical workaround right now: `hvCurrent` alone is already live and its
sign/magnitude likely indicates charge vs. idle (e.g. `-9` A while
trickle-charging near full) — once you've observed enough real values to
know the sign convention for your car, we can switch the heuristic to use
current alone instead of power. `[VCU] Charging HVIL Status` (`22031D`,
high-voltage interlock — typically closed when the charge connector is
latched) is untested but worth enabling as a more direct signal.

**WiCAN going offline vs. the car unplugging.** The WiCAN itself drops
offline from time to time (reboots, wifi blips) — that's a transport issue,
not the car leaving. `deviceOnline` in `/api/vehicle` reflects the raw
transport honestly (stale after `SIGNAL_STALE_MS`, 2 min by default) and is
there for monitoring. But the `status` field evcc reads holds the last
known `B`/`C` for `STATUS_HOLD_MS` (15 min by default, `app/.env`) after the
WiCAN goes quiet, instead of immediately dropping to `A`. Without this, any
WiCAN blip longer than 2 minutes gets reported to evcc as "car
disconnected," which can interrupt an active charging session/plan for no
real reason. Only a genuinely sustained outage (or the process restarting
without ever having seen the device) falls back to `A`. `statusHeld: true`
in the `/api/vehicle` response tells you when a held value is currently
being reported. Don't be tempted to just hardcode `status` to `B`/`C`
permanently instead — evcc uses A/B/C as ground truth for whether a car is
plugged in at all, so that would make it blind to real disconnects (car
actually driven away) too.

`soc`, `soh`, `odometerKm` and `rangeKm` go further: they always report
their last known value, however old, and are only `null` if never seen at
all. The WiCAN can sleep for hours while the car is parked, and evcc can't
parse `null` (`strconv.ParseFloat: parsing "<nil>"`), so its vehicle
validation used to fail whenever the device happened to be asleep.
`hvVoltage`/`hvCurrent`/`chargePowerKw` are deliberately never held, since
a stale current reading could misrepresent whether charging is actively
happening. `dataHeld: true` in the response means the device is offline and
those fields are last-known values.

**Why the WiCAN goes offline at all:** checked
`http://<wican-ip>/restart_tracker/history` on the device itself — of
277 total boots, 276 are `"was_planned": true`, `"planned_reason":
"power_wake"`, `"source": "sleep_mode"` (only 1 ever unexpected). This is
deliberate firmware power-saving (protects the car's 12V battery while
parked), not a fault, and isn't exposed as a setting in the WiCAN web UI.
Per-cycle downtime in that history was short (roughly 10–70s between the
sleep request and the next boot), though real HTTP unreachability runs a
bit longer due to wifi reassociation after each reboot — occasionally long
enough to have crossed the old 2-minute staleness cutoff before the hold
logic above existed. Cycle length (how long it stays awake before sleeping
again) varied from ~17 min to 8+ hours, tracking with car/CAN-bus activity.

## Known firmware issues on this device (v4.51p) — for reference, not blockers

These don't need fixing for this gateway to work (we route around them via
HTTP polling), but worth knowing if you poke at the WiCAN UI further:

- Automate tab **Test** button reports errors (`NO DATA` / `No response`)
  for PIDs that are actually working fine in the background — don't trust
  it as a status indicator.
- **Terminal** tool doesn't respond even to purely local commands (`ATZ`),
  regardless of Protocol setting (AutoPID vs ELM327) — likely a broken
  UI/relay feature on this firmware build, not something we could fix from
  outside the device.
- Similar to a still-open community report:
  [meatpiHQ/wican-fw#886](https://github.com/meatpiHQ/wican-fw/issues/886)
  (BMW iX3 — PID works via terminal but AutoPID Test reports no response;
  in our case *neither* worked yet the background poll did).
- If you want to report/track these, meatpiHQ (the maintainer) is
  personally active on GitHub issues.

A more complete, community-validated Xpeng G6 PID profile (32 PIDs
including HV voltage min/max, motor data, charging HVIL status) sits in an
unmerged PR — download `vehicle_profiles/xpeng/xpeng_g6.json` from
[meatpiHQ/wican-fw#568](https://github.com/meatpiHQ/wican-fw/pull/568)
if you want to try importing it for `HV_V`/`SOH`/charging status
(GPL-3.0, so it isn't bundled here).

## Finding more signals

Since `/autopid_data` already gives us a live JSON blob, the easiest way to
find/add a new signal is:
1. In WiCAN's Automate tab, enable the PID row you want (e.g. `HV_V` for
   pack voltage, or try the community profile above for more).
2. Check `curl http://<wican-ip>/autopid_data` — if the key appears
   with a plausible value, it'll automatically flow into this gateway
   (`app/src/httpPoll.js` stores every key lowercased, visible in
   `/api/debug/signals`).
3. To make it show up in the *decoded* `/api/vehicle` view (not just raw
   `/api/debug/signals`), add a field in `app/src/decoder.js` reading
   the lowercased key.

## Operations

Install on a new host (needs Node.js 20.6+):

```bash
git clone https://github.com/vondraussen/xpeng-wican-evcc.git /opt/xpeng-wican-evcc
cd /opt/xpeng-wican-evcc/app
cp .env.example .env              # then set WICAN_HTTP_URL etc.
sudo cp ../xpeng-wican-evcc.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now xpeng-wican-evcc
```

Day to day:

```bash
systemctl restart xpeng-wican-evcc   # after editing .env
systemctl stop xpeng-wican-evcc
journalctl -u xpeng-wican-evcc -n 100 --no-pager
```

State (last known signal values) is persisted to `app/data/state.json` and
survives restarts.

## Security

The HTTP API has no auth (port 8080), fine on a trusted home LAN — don't
expose it directly to the internet without a reverse proxy + auth in
front.

## Notes / what's solid vs. what you'll need to verify yourself

- **Confirmed, live-tested against the real car**: `/autopid_data` polling
  → decode → `/api/vehicle` HTTP API. SOC and odometer values match the
  WiCAN's own dashboard.
- **Unverified**: exact sign/scale convention for `hvCurrent` during
  charging vs. discharging, and whether `HV_V`/`SOH`/charging-status PIDs
  can be made to return data at all on this specific vehicle. No official
  XPeng DBC exists publicly — everything PID-related here is
  community-sourced from WiCAN's GitHub discussions, not a manufacturer
  spec.
