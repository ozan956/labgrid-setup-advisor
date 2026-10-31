# Bench profiles

A bench profile describes the user's real hardware: the board, the controllers
plugged into it, where Labgrid runs, and the names the coordinator will use.
The profile is independent of any single use case. Three consumers read it:
the insight rules, the file generator, and the pre-fill mapping into the
use-case wizards.

The library lives in `src/bench/` and has no React dependency. `src/bench/index.ts`
is the public surface.

## Profile model

`BenchProfile` (`src/bench/types.ts`):

| Field | Meaning |
| --- | --- |
| `version` | Always `1`. Imported JSON with another version is rejected. |
| `board.name`, `board.presetId` | Free text plus an optional id from the board catalog. |
| `topology` | `local` (this computer is plugged into the board) or `remote` (an exporter host is). |
| `sharing` | `solo` or `team`. Selects the remote-power `location` answer and the team steps. |
| `names.place` | Coordinator place name, default `board-01`. |
| `names.group` | Exporter group, defaults to the place name. |
| `names.exporterHost` | Name passed to `labgrid-exporter -n`; part of every `add-match` pattern. |
| `names.coordinator` | `HOST[:PORT]`, default `127.0.0.1:20408`. |
| `names.location` | Optional `location:` label for the exporter group. |
| `devices` | List of `BenchDevice`, see below. |
| `login` | Optional username, login prompt, and shell prompt for `ShellDriver`. |
| `bootloader` | Optional `uboot` or `barebox` with its prompt. |

Names must match `^[A-Za-z0-9][A-Za-z0-9._-]*$` (`NAME_PATTERN` in
`src/bench/profile.ts`).

### Device kinds

| Kind | Role | Labgrid resource | Driver | Fields |
| --- | --- | --- | --- | --- |
| `usb-serial` | console | `USBSerialPort` | `SerialDriver` | `match`, `speed`, optional `usbId`, `deviceNode` |
| `network-serial` | console | `NetworkSerialPort` | `SerialDriver` | `host`, `port`, `speed`, `protocol` (`raw` or `rfc2217`) |
| `network-pdu` | power | `NetworkPowerPort` | `NetworkPowerDriver` | `model` (backend module), `host`, `index` |
| `ykush` | power | `YKUSHPowerPort` | `YKUSHPowerDriver` | `serial`, `index` as a string (`1`..`3` or `a`) |
| `usb-hub-port` | power | `USBPowerPort` | `USBPowerDriver` | `match` (hub interface, `ID_PATH` ends in `:1.0`), `index` |
| `manual-power` | power | none | `ManualPowerDriver` | none |
| `usb-debugger` | debug | `USBDebugger` | `OpenOCDDriver` | `match`, optional `interfaceConfig`, `boardConfig` |
| `dfu` | debug | `DFUDevice` | `DFUDriver` | `match` |
| `fastboot` | debug | `AndroidUSBFastboot` | `AndroidFastbootDriver` | `match`, `usbId` |
| `usb-sd-mux` | storage | `USBSDMuxDevice` | `USBSDMuxDriver` | `match` (`ID_PATH`) |
| `usb-storage` | storage | `USBMassStorage` | `USBStorageDriver` | `match` |
| `imx-usb-loader` | bootstrap | `IMXUSBLoader` | `IMXUSBDriver` | `match` |
| `network-service` | network | `NetworkService` | `SSHDriver` | `address`, `username`, `port` |
| `unsupported-usb` | other | none | none | `usbId`; kept so the user sees it was not ignored |

`deviceRole()` in `src/bench/profile.ts` derives the role column. `match` is a
plain `Record<string, string>` written verbatim into the `match:` block, so keys
such as `'@ID_PATH'` keep their `@` prefix.

## Detection pipeline

The user pastes command output. `parseHardwareText()` detects the format and
calls `suggestDevices()` with the parsed records, the hardware catalog, and the
devices already in the profile.

| Input | Parser | Information available |
| --- | --- | --- |
| `lsusb` | `parsers/lsusb.ts` | Vendor and product id, description. No match values. |
| `udevadm info /dev/ttyUSB0` | `parsers/udevadm.ts` | Subsystem, ids, `ID_SERIAL_SHORT`, `ID_USB_INTERFACE_NUM`, `ID_PATH`, device node. |
| `labgrid-suggest` | `parsers/suggest.ts` | Resource class and the match blocks Labgrid itself proposes. |

Every USB id is looked up in `src/data/hardware/usb-devices.yaml`. The catalog
class picks the device kind; the entry's `serialNumber` quality and
`multiInterface` flag pick the match keys:

- `ID_SERIAL_SHORT` when the chip family has unique or usually unique serials
  (FTDI, ST-LINK, DAPLink, Pico).
- `ID_PATH` when serials are shared or missing (CP210x modules often report
  `0001`; CH340 and PL2303 have none). The device then stays in the same USB
  port.
- `ID_USB_INTERFACE_NUM` in addition when one converter exposes several UARTs
  (FT2232, FT4232, CP2105, CP2108).
- `ID_PATH` of the mux's own USB device for `USBSDMuxDevice` (the SCSI and
  interface suffixes of the block device path are removed), which is what
  `labgrid-suggest` prints. The upstream examples use `'@ID_PATH'` with the
  path of the hub port instead; `@` keys only match parents, so the two values
  differ.
- Probes are only generated as `USBDebugger` when their catalog class is
  `usb-debugger` or `usb-debugger-with-serial`, which mirrors the upstream
  whitelist (ST-LINK, J-Link, Olimex ARM-USB-OCD/TINY, KitProg3, ADI ICE).
  FTDI FT2232/FT4232/FT232H are classified as serial consoles, and Altera
  USB-Blasters become `AlteraUSBBlaster`.
  CMSIS-DAP probes such as DAPLink are detected as consoles only, and
  USB-Blasters become `AlteraUSBBlaster` through `resourceClass`.
- `ID_PATH` with the `:1.0` interface suffix for `USBPowerPort`.

Candidates carry a confidence: `high` when the match values are known
(udevadm, labgrid-suggest), `medium` when only the id is known (lsusb), `low`
for generic hubs and unknown ids. A debugger with a virtual COM port yields two
candidates, the probe and the console. Root hubs are dropped; Labgrid classes
the advisor does not generate are listed under "skipped" with a reason.
Candidates equal to an existing device are suppressed.

## Insight rules

`analyzeProfile()` in `src/bench/insights.ts` returns insights sorted
critical, warning, info, success. Per-device rules use `rule:deviceId` ids.

| Id | Severity | Trigger |
| --- | --- | --- |
| `missing-match` | critical | A device has no usable match value, serial, or host. |
| `pdu-unknown-model` | critical | `model` is not a backend in the catalog; `NetworkPowerDriver` imports `labgrid.driver.power.<model>`. |
| `pdu-index-out-of-range` | critical | Outlet index below the backend's base or above its maximum. |
| `invalid-name` | critical | Place or group fails `NAME_PATTERN`. |
| `no-console` | warning | No serial console device. |
| `shared-serial-number` | warning | Match uses `ID_SERIAL_SHORT` on a chip with shared or no serials. |
| `openocd-config` | warning | Debug probe without `interface_config` and `board_config`. |
| `usb-hub-verify` | warning | `USBPowerPort`: confirm with `uhubctl` and check the `:1.0` path. |
| `usb-hub-power-budget` | warning | USB-powered board that draws more than a hub port supplies. |
| `pdu-host-format` | warning | URL given to a plain-host backend or the reverse. |
| `remote-exporter-name` | warning | Remote topology without an exporter name. |
| `login-without-console` | warning | Login or bootloader given but no console; also suppresses `ready`. |
| `redundant-manual-power` | warning | Manual power listed next to a real controller; the manual entry is not generated. |
| `no-power` | info | No power device; only `ManualPowerDriver` is possible. |
| `multi-interface-serial` | info | Multi-UART chip without `ID_USB_INTERFACE_NUM`. |
| `debugger-serial-port` | info | The probe also provides a virtual COM port. |
| `ykush-tools` | info | `ykushcmd` installation and serial lookup. |
| `pdu-index-base` | info | Whether the backend counts outlets from 0 or 1. |
| `pdu-requirements` | info | Extras such as `labgrid[snmp]` or net-snmp tools. |
| `pdu-credentials` | info | The backend hardcodes credentials. |
| `remote-exporter-tools` | info | ser2net, dialout group, `/var/cache/labgrid`. |
| `remote-coordinator-address` | info | Non-default coordinator; set `LG_COORDINATOR` or `-x`. |
| `team-sharing` | info | Places, acquire/release, tags, reservations. |
| `board-console-hint`, `board-power-hint`, `board-bootloader-hint` | info | Facts from the board preset. |
| `unsupported-devices` | info | Devices Labgrid cannot control. |
| `strategy-ready` | success | Power, console, and login present; a strategy is generated. |
| `ready` | success | No critical insight and at least one console or power device. |

## Generated files

`generateBenchFiles()` in `src/bench/generate.ts` builds JavaScript objects
and serializes them with the `yaml` package, so the output is always valid
YAML.

| Topology | File | Target | Content |
| --- | --- | --- | --- |
| local | `environment.yaml` | this computer | `targets.main` with real resources and drivers |
| remote | `exporter.yaml` | exporter host | one group with every exportable resource |
| remote | `remote.yaml` | client | `RemotePlace` plus the same drivers |
| remote, non-default coordinator | `labgrid-exporter.override.conf` | exporter host | `Environment="LG_COORDINATOR=..."` drop-in |
| both | `SETUP.md` | anywhere | bench summary and the checklist |
| both | `bench-profile.json` | anywhere | the profile for import |

Rules:

- Resources come before drivers; `SerialDriver` precedes `ShellDriver`, and
  console, power, and bootloader drivers precede the strategy.
- When one resource class occurs once, the plain mapping form is used. When a
  class repeats, or there are several consoles or power controls, resources and
  drivers switch to the documented list form with `name:` and `bindings:`.
  In `exporter.yaml` repeated classes become `<slug>: { cls: <Class>, ... }`
  entries. The client takes those keys as resource names, so the wildcard
  `add-match` is enough; `add-named-match` is not used. Every `bindings:`
  value names a driver instance; a driver that is only referenced by a
  binding receives an explicit `name` for that purpose.
- `ShellDriver` is added when `login` is set; `UBootDriver` or `BareboxDriver`
  when `bootloader` is set. `UBootStrategy` or `BareboxStrategy` is added when
  bootloader, power, and login exist; `ShellStrategy` when power and login
  exist without a bootloader. All of these need a console device; without one
  they are left out and the `login-without-console` insight explains why.
- `manual-power` adds `ManualPowerDriver` with the board or place name and no
  resource. When a real power controller exists as well, the manual entry is
  left out (two `PowerProtocol` drivers would make the target ambiguous) and
  the `redundant-manual-power` insight says so.
- YKUSH `index` is written as a string, `USBPowerPort` and `NetworkPowerPort`
  indices as numbers, matching the upstream constructors.
- Missing values are written as `<TOKEN>` (for example `<ID_PATH>`,
  `<PDU_HOST>`) and listed in `GeneratedFile.unresolved`. An empty match
  becomes `<ID_SERIAL_SHORT>` for serial consoles and probes, and `<ID_PATH>`
  for hub ports, USB-SD-Mux and other path-matched devices.
- Exporter files use `##` comments only. `labgrid-exporter` renders its
  configuration through Jinja2 with `#` as the line-statement prefix, so a
  plain `# comment` is a template syntax error. Environment files are plain
  YAML and use `#`.
- Nothing is written under `tools:`; tool paths are site specific and the
  checklist explains where to set them.

## Checklist

`buildChecklist()` in `src/bench/checklist.ts` produces ordered steps with a
target (`exporter-host`, `client`, `coordinator-host`, `anywhere`), prose for a
first-time user, commands, and documentation links. Steps are added only when
the profile needs them:

| Step id | When |
| --- | --- |
| `install-labgrid` | always; adds backend extras such as `pip install 'labgrid[snmp]'` |
| `install-tools` | a device needs `uhubctl`, `ykushcmd`, `usbsdmux`, `openocd`, `dfu-util`, `fastboot`, `imx-usb-loader`, or `ser2net` |
| `device-access` | any USB device (dialout group) |
| `fill-placeholders` | a generated file has unresolved tokens (`labgrid-suggest`, `udevadm info`) |
| `start-coordinator`, `start-exporter`, `check-resources`, `create-place`, `acquire` | remote topology |
| `share` | remote topology with `sharing: team` (`set-tags`, `eval "$(labgrid-client reserve --wait --shell ...)"`, then `-p +`) |
| `try-environment` | local topology (Python snippet with `Environment`) |
| `run-tests` | always (`pytest --lg-env <file>`) |
| `verify` | always |

Commands include the real place, group, exporter name, and `-x <coordinator>`
when the coordinator is not the default.

## Pre-filling the wizards

`prefillForUseCase()` in `src/bench/prefill.ts` maps the profile to answers and
placeholder values for one use case. An answer is emitted only when the option
exists in the loaded definition, so YAML edits cannot produce invalid answers.
`applyPrefill()` applies the answers through `DecisionEngine.setAnswer` in
question order and skips anything invalid or hidden.

| Use case | Answers from the profile |
| --- | --- |
| `remote-power-control` | `power-source` from the preset's power inputs; `output-count`; `controller` from the first power device; `location` (`local`, `remote-host`, `remote-lab`); `pdu-model` (`netio`, `gude`, `eaton`, `apc`, else `unknown`) |
| `serial-console-access` | `serial-hardware`, `network-protocol`, `location` |
| `firmware-flashing` | `flash-method` from the first debug device, `location` |
| `automated-hardware-testing` | `test-level` (`shell` when login is set), `topology` |
| `remote-board-access` | `access-level`, `sharing` (`named-users` or `pooled-users`) |
| `ci-integration`, `board-farm-setup` | values only |

Values use the shared placeholder tokens: `PLACE_NAME`, `EXPORT_GROUP`,
`PHYSICAL_LOCATION`, `ALLOCATED_PLACE`, `SERIAL_NUMBER`, `SERIAL_DEVICE`,
`BAUD_RATE`, `SERIAL_HOST`, `SERIAL_PORT`, `SHELL_PROMPT`, `LOGIN_PROMPT`,
`USERNAME`, `PDU_HOST`, `PDU_OUTLET_INDEX`, `YKUSH_SERIAL`,
`YKUSH_PORT_INDEX`, `UDEV_ID_PATH`, `USB_PORT_INDEX`, `BOARD_NAME`,
`INTERFACE_CONFIG`, `BOARD_CONFIG`, `USB_VENDOR_ID`, `USB_PRODUCT_ID`.
`DecisionEngine.configurations(answers, values)` substitutes them, quoting
values that are not safe bare YAML scalars, and marks a file ready when every
required placeholder has a value.

## Persistence and sharing

`src/bench/storage.ts` stores the profile under the localStorage key
`labgrid-advisor-bench`. `encodeShareHash()` writes the profile as base64url
JSON into the URL fragment (`#bench=...`); `decodeShareHash()` reads it back.
Imported JSON and decoded links are validated against
`schemas/bench-profile.schema.json`, which uses `kind` as a discriminator and
rejects unknown fields and duplicate device ids. The advisor never asks for
passwords; a profile should not contain any.

## Sample benches and validation

`src/bench/samples.ts` holds four example benches: a Raspberry Pi 4 behind a
NETIO PDU in a shared lab, an STM32 Nucleo with an ST-LINK on this computer,
an i.MX 8M Mini EVK with a YKUSH and serial download mode, and a ZCU102 on a
`uhubctl` hub with a USB-SD-Mux. `npm run validate:labgrid` renders them
through Vite's SSR module runner and checks every environment and exporter
file with the real Labgrid package (`scripts/validate_with_labgrid.py`).

## Limits

- No hardware probing in the browser; the user pastes command output.
- No credentials are collected or written.
- The catalog is a curated set of common devices, not a compatibility matrix.
- Multiple targets per environment file are not generated.
