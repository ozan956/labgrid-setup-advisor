# Hardware catalog

The hardware catalog is reviewed YAML under `src/data/hardware/`. It gives the
bench feature its device knowledge: which USB ids are consoles, probes, or
power switches; what each network PDU backend expects; and what a known board
typically needs. The catalog is data, not code. Adding an entry never requires
a React or engine change.

| File | Schema | Loaded as |
| --- | --- | --- |
| `usb-devices.yaml` | `schemas/hardware-usb-devices.schema.json` | `HardwareCatalog.usbDevices` |
| `pdu-models.yaml` | `schemas/hardware-pdu-models.schema.json` | `HardwareCatalog.pduModels` |
| `boards.yaml` | `schemas/hardware-boards.schema.json` | `HardwareCatalog.boards` |

`loadHardwareCatalog()` in `src/bench/catalog.ts` validates each file with the
schema and then applies semantic checks: lowercase four-digit hex ids, no
duplicate vendor and product pair, unique backend names matching
`^[a-z0-9_]+$`, unique kebab-case board ids, `indexMax` not below `indexBase`,
and `openocdInterface` values shaped like `interface/<name>.cfg`. Errors are
collected and reported together.

## USB devices

```yaml
- vendorId: '10c4'
  productIds: ['ea60']
  vendor: Silicon Labs
  product: CP2102/CP2104 USB to UART bridge
  class: usb-serial
  chip: cp210x
  serialNumber: shared
  notes:
    - Many CP2102 modules report the serial 0001, so match on ID_PATH.
```

| Field | Meaning |
| --- | --- |
| `vendorId`, `productIds` | Quoted lowercase hex. Quote them; `04e8` would otherwise parse as a number. |
| `vendor`, `product` | Names as in the usb.ids database where available. |
| `class` | `usb-serial`, `usb-debugger`, `usb-debugger-with-serial`, `altera-usb-blaster`, `dfu`, `fastboot`, `ykush`, `usb-hub`, `usb-sd-mux`, `usb-sd-wire`, `imx-usb-loader`, `hid-relay`, `sispm`, `lxa-usb-mux`, `usb-storage`, `root-hub`, `unsupported`. |
| `chip` | Converter or probe family (`ftdi`, `cp210x`, `ch340`, `pl2303`, `stlink`, `jlink`, `daplink`, ...). |
| `serialNumber` | `unique`, `usually-unique`, `shared`, or `none`; selects `ID_SERIAL_SHORT` versus `ID_PATH`. |
| `openocdInterface` | Suggested OpenOCD interface script for probes. |
| `multiInterface` | True when one converter exposes several UARTs. |
| `notes` | Hedges and sources. |

Detection maps `class` to a device kind (see [bench.md](bench.md)). Classes
Labgrid supports but the advisor does not generate yet (`hid-relay`, `sispm`,
`lxa-usb-mux`, `usb-sd-wire`) are reported as skipped with the class name.

## PDU models

One entry per backend module in `labgrid/driver/power/`. The `model` value is
the module name and is written verbatim into `NetworkPowerPort.model`.

| Field | Meaning |
| --- | --- |
| `model` | Backend module name, for example `gude8225`. |
| `family` | Hardware family shown to the user. |
| `indexBase` | `0` or `1`, the first outlet index the backend accepts. |
| `indexMax` | Highest index when the backend enforces one. |
| `hostFormat` | `host` for a plain hostname, `url` when the backend parses `http(s)://...`. |
| `requirements` | Extras or tools: `pip install 'labgrid[snmp]'`, net-snmp CLI tools, `telnet`, environment variables. Command-like entries become checklist commands; the rest become prose. |
| `notes` | Hardcoded credentials, tested models, protocol remarks. |
| `confidence` | `verified` when upstream names tested hardware, `source` when inferred from the code. |

## Board presets

| Field | Meaning |
| --- | --- |
| `id`, `name`, `vendor`, `family` | Identity and a loose family tag used for rules. |
| `console.interface` | `onboard-usb`, `uart-header`, `cdc-acm`, or `none`. |
| `console.speed`, `console.chip`, `console.note` | Typical baud rate, converter chip, wiring notes. |
| `power.inputs`, `power.note` | `usb-c`, `micro-usb`, `barrel`, `poe`, `atx`, `other`; current notes. |
| `flashing` | `sd-card`, `openocd`, `dfu`, `fastboot`, `imx-usb-loader`, `uuu`, `jtag-vendor`. |
| `bootloader.kind`, `bootloader.prompt`, `bootloader.note` | `uboot`, `barebox`, or `none`; only give a prompt you are sure of. |
| `tags`, `notes`, `docs` | Search tags, hedged facts, HTTPS links. |
| `verification` | Required. `lab` when the preset was confirmed on real hardware with Labgrid, `docs` when vendor documentation or the source trees confirm the facts and `docs` links them, `unverified` when the entry was imported mechanically and nobody has reviewed it against documentation yet. |
| `sources` | Provenance pointers in the form `tree: path`, for example `u-boot: configs/imx8mp_evk_defconfig`, `linux: arch/arm64/boot/dts/freescale/imx8mp-evk.dts`, `openocd: tcl/board/st_nucleo_f7.cfg`. Required for `unverified` entries. |

Presets feed the `board-*-hint` insights, the `power-source` pre-fill answer,
and the console speed and bootloader defaults. The UI shows the verification
level next to the preset facts so users know how much to trust them.

### Growing the board list

Most board facts the advisor needs already exist in the open source trees a
Labgrid user has around: U-Boot sets the shell prompt and the console baud
rate per board, the Linux device tree names the console UART, Buildroot names
the getty port, and OpenOCD board files name the on-board debug probe. The
import script extracts those facts so a contributor only has to add what the
trees cannot know (the USB-UART chip on the board, the power connector, the
documentation link).

1. Add a seed to `scripts/board-seeds.yaml`. A seed has an `id`, `name`,
   `vendor`, `family`, pointers into the trees (`uboot` defconfig name,
   optional `dts` override, `buildroot` defconfig name, `openocd` board file
   or `openocdTarget` target file), optional hand-written `console`, `power`,
   `flashing`, `bootloader`, `tags`, `notes` and `docs` that win over derived
   values, and `curation`, the verification level you intend to set after
   checking the documentation you link.
2. Run the import with the trees checked out next to the labgrid repository
   (`../../u-boot`, `../../linux`, `../../openocd`, `../../buildroot` relative
   to this project; override with `--u-boot`, `--linux`, `--openocd`,
   `--buildroot`):

   ```bash
   npm run import:boards -- --out /tmp/candidates.yaml
   ```

   The script prints one line per seed, writes every candidate in the shape of
   a `boards.yaml` entry with `verification: unverified`, a `sources` list and
   a `## derived:` comment block with the raw facts and any conflicts (for
   example a U-Boot baud rate that differs from the device tree), and exits
   non-zero when a seed resolves nothing.
3. Read the derived block, compare it with the vendor documentation, fix the
   guessed fields (`console.interface`, `power.inputs`), paste the entry under
   `boards:` in `src/data/hardware/boards.yaml`, and set `verification: docs`
   only when a `docs` link backs the facts. Leave `unverified` otherwise; the
   tests enforce that unverified entries keep their `sources`.

A bench that has been through the plan page's checklist can skip the import:
the "Contribute this board" card on the plan page renders the bench as a
ready `boards.yaml` entry with `verification: lab` (see
[docs/bench.md](bench.md#verification-badge-and-contributing-a-board)).

Curation rules: copy only facts from the trees (prompt strings, baud rates,
UART labels, file names), never prose or comments; keep U-Boot prompts exactly
as `CONFIG_SYS_PROMPT` spells them, including the trailing space (when a
defconfig does not set it the Kconfig default applies: `=> `, or `Zynq> ` and
`ZynqMP> ` on Zynq); state unusual rates such as the 1500000 baud of Rockchip
boards explicitly; say so when the stock firmware is not U-Boot; name the
converter chip only with a value that exists in `usb-devices.yaml`; and link
HTTPS documentation rather than quoting it.

## Accuracy rules

- Verify USB ids against the usb.ids database (`/usr/share/hwdata/usb.ids` or
  `/var/lib/usbutils/usb.ids`) or the vendor's documentation. When neither
  confirms an id, name the source in `notes` (for example "per pykush").
- Verify every Labgrid class name, parameter, and backend behaviour in the
  upstream source. Index bases and host formats come from the backend module.
- Hedge board facts that vary by revision ("typically", "check the board
  manual") or leave them out.
- Record how a board preset was verified; never raise `verification` above
  what you actually checked.
- Do not claim `uhubctl` support for a hub id; per-port switching depends on
  the exact product and must be tested.
- Never store credentials, private hostnames, or copied manual text.

## Tests

`tests/hardware-catalog.test.ts` loads the bundled catalog and checks entry
counts, lookups, search, id hygiene, the pinned list of upstream backend
names, the loader's error reporting, that every board carries a verification
level (with `sources` when unverified and a `docs` link when documented), that
every `console.chip` names a chip the USB device catalog knows, and a few
facts imported from the source trees. `npm test` runs it, so an invalid entry
fails the build.
