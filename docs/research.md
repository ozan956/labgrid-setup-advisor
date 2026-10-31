# Upstream research

Research was performed against `labgrid-project/labgrid` at commit
`eb05ee6730c0896ec90327ed9b49c93ecd4a5c13` (`v26.0-216-geb05ee67`,
2026-10-23). The advisor should name this target when correctness depends on a
particular upstream revision.

## Core model

Labgrid models a device under test as a target. Resources are passive
descriptions of hardware or services, drivers bind to resources or protocols
and implement actions, and strategies coordinate drivers to move a target
between states. The factory builds resources before drivers in YAML order and
rejects unknown classes or invalid constructor arguments.

Local environment files have this shape:

```yaml
targets:
  main:
    resources:
      NetworkPowerPort:
        model: netio
        host: pdu.example.org
        index: 1
    drivers:
      NetworkPowerDriver: {}
```

Remote operation adds an exporter and coordinator. Exporter YAML is grouped by
physical setup rather than by target:

```yaml
board-01:
  NetworkPowerPort:
    model: netio
    host: pdu.example.org
    index: 1
```

A client environment then uses a `RemotePlace`; the coordinator expands that
place into the resources published by the exporter:

```yaml
targets:
  main:
    resources:
      RemotePlace:
        name: board-01
    drivers:
      NetworkPowerDriver: {}
```

The coordinator manages resource discovery, places, reservations, acquisition,
and mutual exclusion. Control traffic does not generally pass through it.
Exporters publish resources and expose host-local tools or devices. Clients use
places through `labgrid-client`, pytest, or the Python API.

## Inventory and binding checks

The targeted tree contains the registered resources and drivers under
`labgrid/resource` and `labgrid/driver`, and the built-in strategies
`BareboxStrategy`, `UBootStrategy`, `ShellStrategy`, `DockerStrategy`, and
`GraphStrategy`. The advisor does not maintain a second complete class catalog;
each use case names only the classes it needs and those names are checked during
review and optional upstream validation.

For remote power control, the relevant upstream bindings are:

| Approach | Resource | Driver | Important dependency |
| --- | --- | --- | --- |
| Network PDU | `NetworkPowerPort` | `NetworkPowerDriver` | A backend matching the PDU model; some backends need optional Python extras |
| Generic smart USB hub | `USBPowerPort` locally, exported as `NetworkUSBPowerPort` | `USBPowerDriver` | `uhubctl` on the machine connected to the hub |
| Yepkit YKUSH | `YKUSHPowerPort` locally, exported as `NetworkYKUSHPowerPort` | `YKUSHPowerDriver` | `ykushcmd` on the machine connected to the YKUSH |
| No automated hardware | none | `ManualPowerDriver` | A person must perform each requested power action |

All three automated drivers implement `PowerProtocol` and `ResetProtocol`.
No strategy is required for power control alone. Strategies become useful when
power is one step in a larger boot-state transition.

### Network power

`NetworkPowerPort` requires `model`, `host`, and `index`. Its driver imports a
module from `labgrid/driver/power/<model>.py`. The targeted tree includes
backends such as `apc`, `eaton`, `gude`, `netio`, `raritan`, `sentry`, Shelly,
Digital Loggers, PoE, REST, and other documented implementations. Compatibility
is backend-specific, so the advisor asks for a known model and leaves the host
and outlet index as explicit placeholders. It must not label an arbitrary
network PDU as supported.

A network PDU switches a complete outlet. It is suitable for an external power
adapter only when the adapter and board are electrically compatible and the
chosen outlet is correct. Credentials embedded in a URL are possible for some
backends but should not be placed in a committed example.

### USB power

`USBPowerPort` is a udev-managed resource for one downstream port on a hub. Its
match is forced to a USB hub interface (`DEVTYPE=usb_interface`, `DRIVER=hub`),
and its `index` is an integer. `USBPowerDriver` calls `uhubctl` with the hub
path and port. The upstream example uses an `ID_PATH` ending in `:1.0` and an
integer port index.

`uhubctl` only works with hubs that actually implement per-port power switching.
Many hubs do not. Its official compatibility list and a local `uhubctl` probe
must be used before relying on this path. Switching a USB data port is not a
substitute for switching an unrelated external DC input.

### YKUSH power

`YKUSHPowerPort` requires a YKUSH serial string and port index.
`YKUSHPowerDriver` probes the `ykush`, `ykushxs`, and `ykush3` models with
`ykushcmd`, then invokes that tool to switch the selected downstream port.
When exported, it becomes `NetworkYKUSHPowerPort` and the command runs through
the exporter host's SSH command prefix.

## Components used by the additional workflows

The later advisor workflows reuse the same target, exporter, coordinator, and
place model with these verified upstream bindings:

| Goal | Resource | Driver |
| --- | --- | --- |
| USB serial console | `USBSerialPort`, exported as `NetworkSerialPort` | `SerialDriver` |
| TCP or RFC2217 console | `NetworkSerialPort` | `SerialDriver` |
| Linux commands over a console | the serial resources above | `SerialDriver` then `ShellDriver` |
| OpenOCD flashing | `USBDebugger`, exported as `NetworkUSBDebugger` | `OpenOCDDriver` |
| USB Fastboot | `AndroidUSBFastboot`, exported as `RemoteAndroidUSBFastboot` | `AndroidFastbootDriver` |
| USB DFU | `DFUDevice`, exported as `NetworkDFUDevice` | `DFUDriver` |

`OpenOCDDriver` requires board- and probe-specific scripts. Fastboot partition
names and DFU alternate settings are also target-specific, so the advisor does
not infer them. Shared testing, CI, remote access, and board-farm workflows use
`RemotePlace`, coordinator acquisition, place tags, and reservations instead
of introducing new hardware classes.

## Configuration validation

`labgrid.environment.Environment` loads an environment YAML file and lazily
constructs a target through `target_factory`. Calling `get_target()` validates
class names, constructor parameters, and driver bindings without requiring the
power hardware to be present. Managed USB resources may remain unavailable,
which is acceptable for static validation.

Exporter files are parsed by `labgrid.remote.config.ResourceConfig`. The
exporter selects a specialized export class where one exists; otherwise it
publishes a static resource entry. This explains why a `NetworkPowerPort` can
be declared directly in exporter YAML while `USBPowerPort` and
`YKUSHPowerPort` use specialized exporters.

The project therefore performs three levels of checks:

1. JSON Schema plus semantic validation for decision definitions.
2. YAML parsing of every rendered configuration template using safe sample
   values for placeholders.
3. An optional upstream validation script which loads environment templates
   through Labgrid and exporter templates through `ResourceConfig` when the
   Python package is available.

No physical device is needed for these checks. Runtime availability and real
PDU compatibility still require hardware testing.

## `labgrid-suggest`

`labgrid-suggest` continuously watches udev and instantiates a fixed list of
USB-related managed resources with suggestion callbacks. For a matching device
it prints device metadata and one or more YAML resource fragments, usually
using `ID_PATH` or `ID_SERIAL_SHORT`. For `USBPowerPort` it prints an unknown
`index: ?` because the physical downstream port cannot be inferred.

It is complementary to this application:

- `labgrid-suggest` answers “how can this attached USB device be matched?”
- Setup Advisor answers “which architecture, resource, driver, and config type
  fit my goal and topology?”

The advisor links to `labgrid-suggest` for discovering stable udev identifiers
instead of recreating USB discovery in a browser.

## Pull request #1879

[PR #1879](https://github.com/labgrid-project/labgrid/pull/1879), “doc: add
usecases of labgrid”, was open and non-draft when inspected. It adds only
`doc/use_cases.rst` and one index entry. The document compares four deployment
patterns: one developer/one board, one tester/many boards, shared boards in one
location, and shared boards across locations. It highlights that shared labs
need more guidance around resources, places, environment files, SSH access, and
ownership.

The advisor complements that work without requiring changes to the PR:

- use the same deployment vocabulary in topology recommendations;
- link to the use-case page once it lands;
- keep executable decision data separate from explanatory RST;
- later place reviewed YAML definitions in an upstream data directory while
  the static frontend consumes them as build inputs.

## Primary sources

- [Labgrid repository](https://github.com/labgrid-project/labgrid)
- [Labgrid overview](https://labgrid.readthedocs.io/en/latest/overview.html)
- [Configuration reference](https://labgrid.readthedocs.io/en/latest/configuration.html)
- [Getting started with distributed infrastructure](https://labgrid.readthedocs.io/en/latest/getting_started.html)
- [`labgrid-suggest` manual](https://labgrid.readthedocs.io/en/latest/man/suggest.html)
- [`uhubctl` project and compatible hubs](https://github.com/mvp/uhubctl)
- [Use-case documentation PR #1879](https://github.com/labgrid-project/labgrid/pull/1879)

## Extended research (2026-10-31, v26.0-281-ge6e0754c)

The bench feature was researched against the local upstream checkout at
`/home/odurgut/work/labgrid` (`git describe --tags` prints
`v26.0-281-ge6e0754c`). File paths below are relative to that checkout.

### udev matching (`labgrid/resource/udev.py`, `doc/configuration.rst` "udev Matching")

- `USBResource` sets `SUBSYSTEM: usb` as a default match. Subclasses force
  keys unconditionally: `USBSerialPort` forces `SUBSYSTEM: tty` and
  `@SUBSYSTEM: usb`; `USBPowerPort` and `USBHub` force `DEVTYPE: usb_interface`
  and `DRIVER: hub`; `USBSDMuxDevice` forces `ID_VENDOR_ID: 0424` and
  `ID_MODEL_ID: 4041`; `USBMassStorage` forces `SUBSYSTEM: block` and
  `DEVTYPE: disk`.
- Keys without `@` are checked on the device itself (udev property, then sysfs
  attribute, then pyudev attribute). Keys with `@` are checked against any
  ancestor. All keys are ANDed and values are case sensitive.
- `USBPowerPort` must match the hub interface, so its `ID_PATH` ends with the
  interface suffix, usually `:1.0`; otherwise the `usb` driver is bound instead
  of `hub`. `USBSerialPort` and `USBSDMuxDevice` examples use `@ID_PATH` on the
  parent USB device.
- Vendor and product filters live in `filter_match()`: `USBDebugger` accepts
  FTDI `0403:6010/6014`, ST-LINK `0483:3748/374b/374e/374f/3754`, KitProg3
  `04b4:f155`, Olimex `15ba:0003/002b/0004/002a`, SEGGER `1366:0101-0108`,
  `1001-102f`, `1050-106f`, and Analog Devices `064b` ids; `IMXUSBLoader`
  accepts the NXP `15a2`/`1fc9` serial-download ids; `HIDRelay` accepts
  `16c0:05df` and `5131:2007`; `SiSPMPowerPort` accepts `04b4:fd10-fd15`;
  `DFUDevice` requires `:fe0102:` in `ID_USB_INTERFACES`; `AndroidUSBFastboot`
  defaults to `1d6b:0104` and must be given the real ids.

### `labgrid-suggest` (`labgrid/resource/suggest.py`, `doc/man/suggest.rst`)

Output per device: `=== added device ===` or `=== existing device ===`, then
`<Class> for <device path>`, an optional `=== device properties ===` block
(`device node`, `udev tags`, `vendor`, `vendor (DB)`, `model`, `model (DB)`,
`revision`, `port_number`), then `=== suggested matches ===` with YAML blocks
separated by `---`. A device's own `ID_PATH` is suggested as `ID_PATH`; a parent
path as `@ID_PATH`; `ID_SERIAL_SHORT` comes with `ID_USB_INTERFACE_NUM` when
present. `USBPowerPort` blocks end with `index: ?`, `MatchedSysfsGPIO` with
`pin: ?`. Real output is indented by two spaces; the man page shows it flush
left.

### Exporter configuration (`labgrid/remote/exporter.py`, `labgrid/remote/config.py`)

- Shape: `group -> resource name -> params`. `location` inside a group is
  skipped. `cls` overrides the class when the key is not a class name
  (`console-main: { cls: USBSerialPort, match: ... }`).
- The file is rendered by Jinja2 before YAML parsing with
  `line_statement_prefix '#'` and `line_comment_prefix '##'`; the template
  sees `env`, `isolated`, `hostname`, and `drop_ins` from `<file>.d/*.yaml`.
  A plain `# comment` therefore fails with "Encountered unknown tag"; only
  `##` comments are safe.
- The `exports` table lists the classes with real export handling:
  `USBSerialPort`, `RawSerialPort`, `USBNetworkInterface`, `NetworkInterface`,
  `AndroidUSBFastboot`, `DFUDevice`, `IMXUSBLoader`, `MXSUSBLoader`,
  `RKUSBLoader`, `AlteraUSBBlaster`, `SigrokUSBDevice`, `SigrokUSBSerialDevice`,
  `USBSDMuxDevice`, `USBSDWireDevice`, `USBSDWire3Device`, `USBDebugger`,
  `USBHub`, `USBMassStorage`, `USBVideo`, `USBTMC`, `LXAUSBMux`,
  `USBAudioInput`, `SiSPMPowerPort`, `USBPowerPort`, `DeditecRelais8`,
  `HIDRelay`, `FTDIGPIO`, `USBFlashableDevice`, `TFTPProvider`, `HTTPProvider`,
  `NFSProvider`, `SNMPEthernetPort`, `SysfsGPIO`, `MatchedSysfsGPIO`,
  `NetworkService`, `HTTPVideoStream`, `LXAIOBusPIO`, `AndroidNetFastboot`,
  `YKUSHPowerPort`, `USBADBDevice`. Other classes, including
  `NetworkPowerPort` and `NetworkSerialPort`, are published as generic
  `ResourceEntry` records, which is how the getting-started guide exports a
  `NetworkPowerPort`.
- Exported names are `<exporter>/<group>/<class>/<name>`; USB resources appear
  on the client as `Network*` or `Remote*` classes (`NetworkSerialPort`,
  `NetworkUSBPowerPort`, `NetworkYKUSHPowerPort`, `NetworkUSBDebugger`,
  `RemoteAndroidUSBFastboot`).

### Environment configuration (`doc/configuration.rst` "Environment Configuration")

`targets.<name>.resources`, `drivers`, `options`, `features`, plus top-level
`options`, `features`, `paths`, `images`, `tools`, `imports`. Objects are
created in YAML order. Repeated classes require the list form:

```yaml
resources:
- RawSerialPort:
    name: 'foo'
    port: '/dev/ttyS1'
drivers:
- SerialDriver:
    name: 'foo-driver'
    bindings:
      port: 'foo'
```

`tools:` maps program names (`uhubctl`, `ykushcmd`, `usbsdmux`, `openocd`,
`dfu-util`, `fastboot`, `imx-usb-loader`, ...) to paths; drivers fall back to
the bare name on `PATH`.

### Power backends (`labgrid/driver/power/*.py`, `labgrid/driver/powerdriver.py`)

`NetworkPowerDriver` imports `labgrid.driver.power.<model>`; `index` is passed
as a string. Backends defining `PORT` take a plain host; the others parse a
URL and receive `port=None`.

| Model | Index base | Host | Needs |
| --- | --- | --- | --- |
| `apc`, `sentry` | 1 | host | net-snmp `snmpget`/`snmpset`; community `private` hardcoded |
| `eaton`, `raritan`, `poe_mib` | 1 | host | `labgrid[snmp]` (pysnmp) |
| `netio` | 1 (1-4) | host, port 80 | credentials `admin:admin` hardcoded |
| `netio_kshell` | 1 (1-4) | host, port 1234 | `telnet`, pexpect; `admin admin` hardcoded |
| `gude`, `gude24`, `gude8031`, `gude8225`, `gude8316` | 1 | host, port 80 | HTTP |
| `digipower`, `eg_pms2_network`, `eth008`, `pe6216` | 1 | host, port 80 | HTTP; vendor default credentials hardcoded |
| `digitalloggers_http` | 1 | URL | HTTP |
| `digitalloggers_restapi`, `shelly_gen1`, `shelly_gen2` | 0 | URL | HTTP |
| `mfi_mpower`, `rpm1521`, `tinycontrol`, `tinycontrol_tcpdu`, `ubus` | 1 | URL | HTTP |
| `rest`, `simplerest` | template `{index}` | URL template | HTTP |
| `poe_netgear_plus` | 0 | `http://[user:]password@host/` | `py_netgear_plus` |
| `tplink` | 0 | host | python-kasa |
| `tapo` | 0 | host | python-kasa, `KASA_USERNAME`, `KASA_PASSWORD` |
| `siglent` | 1 (1-2) | host | python-vxi11 (deprecated backend) |

Other power drivers: `USBPowerDriver` binds `USBPowerPort` or
`NetworkUSBPowerPort` and runs `uhubctl -l <path> -p <index> -a on|off`;
`YKUSHPowerDriver` binds `YKUSHPowerPort` or `NetworkYKUSHPowerPort` and runs
`ykushcmd`, probing `ykush`, `ykushxs`, and `ykush3`; `ManualPowerDriver` has
no binding; `SiSPMPowerDriver` runs `sispmctl`; `PDUDaemonDriver` talks HTTP
to pdudaemon. Defaults: `delay` 2.0 s (1.0 for `DigitalOutputPowerDriver`,
5.0 for `PDUDaemonDriver`).

### Other drivers and strategies

- `SerialDriver` binds `SerialPort` or `NetworkSerialPort`; `rfc2217` uses
  pyserial's `rfc2217://`, `raw` uses `socket://`.
- `ShellDriver` requires `prompt`, `login_prompt`, `username`; optional
  `password`, `keyfile`, `login_timeout` (60), `console_ready`,
  `await_login_timeout` (2), `post_login_settle_time` (0).
- `OpenOCDDriver` binds `USBDebugger`, `NetworkUSBDebugger`,
  `AlteraUSBBlaster`, `NetworkAlteraUSBBlaster`; takes `config`, `search`,
  `image`, `interface_config`, `board_config`, `load_commands`; runs `openocd`.
- `DFUDriver` runs `dfu-util`; `AndroidFastbootDriver` runs `fastboot`;
  `USBSDMuxDriver` runs `usbsdmux`; `IMXUSBDriver` runs `imx-usb-loader`;
  `SSHDriver` binds `NetworkService` and runs `ssh`, `scp`, `sshfs`, `rsync`.
- `UBootDriver` defaults: `autoboot` "stop autoboot", `boot_command`
  "run bootcmd", `bootstring` `Linux version \d`. `BareboxDriver` defaults:
  `boot_command` "boot -v", `interrupt` `\x04`.
- `ShellStrategy` binds `power` (PowerProtocol), `console` (ConsoleProtocol),
  `shell` (ShellDriver); states `unknown`, `off`, `shell`. `UBootStrategy` and
  `BareboxStrategy` add `uboot` or `barebox` and the state of the same name.
  Strategies are listed under `drivers:` as `<Class>: {}`.

### Command-line facts

- `labgrid-coordinator` listens on `[::]:20408` by default
  (`labgrid/remote/coordinator.py`).
- `labgrid-exporter [-c|--coordinator HOST[:PORT]] [-n|--name NAME] [--hostname]
  [--fqdn] [-i|--isolated] <resources.yaml>`; the coordinator defaults to
  `LG_COORDINATOR` or `127.0.0.1:20408`; the name defaults to the hostname
  (`labgrid/remote/exporter.py`, argparse). The man page spells the flag `-x`;
  the source uses `-c`. `LG_COORDINATOR` avoids the difference.
- `labgrid-client [-x|--coordinator HOST[:PORT]] [-p|--place PLACE]
  [-c|--config ENV]` with subcommands `resources`, `places`, `create`,
  `add-match PATTERN`, `add-named-match PATTERN NAME`, `acquire`/`lock`,
  `release`/`unlock`, `console`, `power on|off|cycle`, `set-tags KEY=VALUE`,
  `reserve [--wait] [--shell] KEY=VALUE`, `wait`, `-p +` for the current
  reservation, `write-image`, `sd-mux`, `scp`, `sshfs`, `env`
  (`labgrid/remote/client.py`). Environment variables: `LG_ENV`, `LG_PLACE`,
  `LG_COORDINATOR`, `LG_PROXY`, `LG_USERNAME`, `LG_HOSTNAME`, `LG_RESERVATION`.
- The exporter needs `ser2net` for `USBSerialPort` export and `/var/cache/labgrid`
  for uploads.

### systemd units (`contrib/systemd/`)

`labgrid-coordinator.service` runs the coordinator with `DynamicUser=yes` and a
state directory. `labgrid-exporter.service` runs
`labgrid-exporter /etc/labgrid/exporter.yaml`, reads `LG_COORDINATOR` from
`EnvironmentFile=-/etc/environment` or a `systemctl edit` drop-in, uses
`SupplementaryGroups=dialout plugdev`, and restarts every 30 s.
`sysusers.d/labgrid.conf` creates the `labgrid` user; `tmpfiles.d/labgrid.conf`
creates `/var/cache/labgrid` (mode 1775, cleaned after two days).

### pytest (`doc/usage.rst`, `doc/man/pytest.rst`)

`pytest --lg-env <file.yaml>`; `--lg-coordinator HOST[:PORT]`;
`--lg-log[=dir]`; `--lg-initial-state STATE` (strategy must implement
`force()`). Session fixtures `env`, `target`, `strategy`. Marks
`lg_feature` and `lg_xfail_feature`.
