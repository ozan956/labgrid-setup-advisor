# Labgrid Setup Advisor

Labgrid Setup Advisor turns a hardware goal and a description of your bench
into a reviewed Labgrid setup. Describe the board and the controllers plugged
into it once, and the advisor explains what matters for that hardware,
generates exporter and environment files that already contain your values,
and writes a step-by-step checklist with the real place, group, and host
names. The goal-oriented wizards remain available and are pre-filled from the
bench.

The advisor implements seven selectable workflows:

- Remote Power Control;
- Serial Console Access;
- Firmware Flashing with OpenOCD, Fastboot, or DFU;
- Automated Hardware Testing with pytest;
- CI Integration with fixed places or reservation pools;
- Remote Board Access;
- Board Farm Setup.

Remote Power Control covers:

- generic USB hubs supported by `uhubctl` with `USBPowerPort` and
  `USBPowerDriver`;
- Yepkit YKUSH devices with `YKUSHPowerPort` and `YKUSHPowerDriver`;
- supported network PDUs with `NetworkPowerPort` and `NetworkPowerDriver`;
- manual fallback when no safe automated controller is available;
- local benches and remote setups using an exporter, coordinator, and
  `RemotePlace`;
- labs with several boards on one exporter host, each with its own place and
  group, edited together and saved as one profile.

Every workflow produces reviewed component guidance, topology advice, commands,
and conservative Labgrid YAML templates with explicit site-specific placeholders.

## Describe your bench

The landing page offers two paths: start with your hardware, or start with a
goal. The hardware path leads to the bench editor:

1. Name the board, optionally picking one of the 57 known presets (Raspberry
   Pi, i.MX EVKs, STM32 Nucleo and Discovery kits, Zynq and ZynqMP boards,
   Rockchip and RISC-V single-board computers, ADI eval boards, and others).
   Presets supply the typical console speed, power input, and bootloader
   prompt, and each one says whether it was verified from documentation, in a
   lab, or imported mechanically and not yet reviewed.
2. Paste the output of one of these commands run on the machine the hardware
   is plugged into:

   ```bash
   lsusb
   udevadm info /dev/ttyUSB0
   labgrid-suggest
   ```

   The advisor recognizes serial adapters, debug probes, YKUSH hubs, USB-SD-Mux
   boards, DFU and fastboot devices, and NXP serial-download mode, and
   proposes devices with the udev match keys Labgrid needs. `udevadm info` and
   `labgrid-suggest` give complete matches; `lsusb` identifies the device and
   leaves the serial or port path to fill in.
3. Add or edit devices by hand, including network PDUs (every upstream power
   backend is listed with its outlet numbering and host format), network
   serial servers, and SSH logins.
4. Choose whether this computer or a separate exporter host is plugged into
   the board, and set the place, group, exporter, and coordinator names.
5. Optionally describe the Linux login and bootloader prompts.

The plan page then shows a topology diagram, hardware-aware insights (for
example that CP210x adapters share a serial number and should be matched by
USB path, or that a backend counts outlets from zero), the generated files, a
checklist with checkboxes, and the guides that apply to your bench. Guides
open with their answers pre-filled and their placeholders already set.

Generated files:

| File | When | Purpose |
| --- | --- | --- |
| `environment.yaml` | local topology | resources and drivers for pytest and scripts on this computer |
| `exporter.yaml` | remote topology | the exporter group for the machine the hardware is plugged into |
| `remote.yaml` | remote topology | `RemotePlace` plus the same drivers for your computer |
| `labgrid-exporter.override.conf` | remote topology with a coordinator address other than `127.0.0.1:20408` | systemd drop-in setting `LG_COORDINATOR` |
| `SETUP.md` | always | bench summary and the checklist |
| `bench-profile.json` | always | the profile for import on another machine |

Files can be copied, downloaded one by one, or downloaded together as a ZIP
bundle. A share link embeds the profile in the URL fragment, and JSON import
and export move it between browsers.

Everything stays in the browser. The profile is kept in localStorage; no
server receives it. Share links carry the whole profile in the URL, so do not
put secrets in a bench description. The advisor never asks for passwords.

Several boards plugged into the same machine form a lab. The editor keeps the
shared parts (topology, exporter host, coordinator, location) in a left rail
and lists the benches below them; each bench has its own board, devices, place
and group. "Duplicate bench" prepares a second unit of the same board with the
udev match values cleared, imports accept both lab and single-bench files, and
older saved benches and `#bench=` share links open as a one-bench lab. See
[docs/lab.md](docs/lab.md).

See [docs/bench.md](docs/bench.md) for the profile model, detection, insight,
and generation rules, and [docs/hardware-catalog.md](docs/hardware-catalog.md)
for adding devices and boards.

## Why it exists

Labgrid's reference documentation describes individual components well, but a
new user often starts with a goal or a box of hardware rather than a class
name. This project keeps that goal-oriented and hardware-oriented guidance in
reviewable YAML and renders it in a standalone static application. It
complements `labgrid-suggest`: the upstream utility discovers udev matches for
attached USB devices, while this advisor chooses an architecture and component
set and turns pasted `labgrid-suggest` output into complete files.

Research and recommendations target upstream commit
`eb05ee6730c0896ec90327ed9b49c93ecd4a5c13` (`v26.0-216-geb05ee67`). The bench
research was extended against `v26.0-281-ge6e0754c`. See
[docs/research.md](docs/research.md).

## Run locally

Node.js 20 or newer is required.

```bash
npm install
npm run dev
```

Open the URL printed by Vite.

## Check and build

```bash
npm run check
npm test
npm run build
```

`npm run validate:labgrid` renders every use-case configuration with safe
sample values and every sample bench with its real values, then validates them
against an installed Labgrid package or a sibling upstream checkout. The
script loads the TypeScript generator through Vite's SSR module runner, so it
needs the project's dev dependencies. Point `PYTHON` at an interpreter with
Labgrid installed and set `LABGRID_REQUIRED=1` when Labgrid must be present:

```bash
PYTHON=/path/to/venv/bin/python LABGRID_REQUIRED=1 npm run validate:labgrid
```

The production site is written to `dist/` and needs only static hosting.

## How decision trees work

YAML definitions under `src/data/` contain questions, conditions,
recommendations, configuration templates, commands, and documentation links.
Vite discovers definition files automatically. The loader validates each file
with `schemas/use-case.schema.json` plus semantic checks before the UI can use
it.

The TypeScript engine in `src/engine/` is independent of React. It determines
visible questions, reconciles changed answers, selects every matching
recommendation, renders configurations, and substitutes placeholder values
supplied by the user or the bench. React components do not contain
Labgrid-specific decision branches.

To add a use case, add its YAML definition and a catalog entry, then add path
tests. See [docs/adding-usecases.md](docs/adding-usecases.md) and
[docs/decision-tree-schema.md](docs/decision-tree-schema.md).

## Hardware knowledge

`src/data/hardware/` holds the reviewed USB id list, the network PDU backend
table, and the board presets, each with a JSON Schema under `schemas/`. New
board presets start from `npm run import:boards`, which extracts prompts, baud
rates, console UARTs and debug probes from local U-Boot, Linux, Buildroot and
OpenOCD trees (see [docs/hardware-catalog.md](docs/hardware-catalog.md)). The
bench library in `src/bench/` loads them, parses pasted command output,
evaluates insight rules, generates files, and maps a profile onto the wizards.
It has no React dependency and is covered by its own tests.

## Configuration safety

Generated files are templates until every required value is present.
Hardware-specific values remain as angle-bracket placeholders, the result page
marks such a file as not ready to run, and a file becomes "ready" only when
the values come from the bench or are typed in. The advisor never stores
credentials, probes hardware, or claims that an unverified PDU or ordinary USB
hub is compatible.

Exporter resource YAML and client environment YAML are presented as different
files. Exporter files use `##` comments because `labgrid-exporter` renders
them through Jinja2 with `#` as the statement prefix. Remote resources still
need a configured place and the operational access described by upstream
Labgrid documentation.

## Architecture boundary

The web application owns parsing, decision evaluation, bench analysis, and
presentation. The definitions and the hardware catalog are build inputs with
no frontend imports or React concepts. They can later move into the upstream
Labgrid repository and be fetched or vendored at build time without changing
the engine or bench APIs.

See [docs/architecture.md](docs/architecture.md) for the complete boundary and
[CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow.

## Project layout

```text
schemas/           JSON Schema for use-case definitions, hardware data, and bench profiles
src/data/          YAML catalog and decision definitions
src/data/hardware/ USB ids, PDU backends, board presets
src/engine/        framework-independent validation and decision logic
src/bench/         bench profile library: catalog, parsers, insights, generators
src/components/    generic React presentation components
tests/             schema, engine, generator, bench, definition, and journey tests
scripts/           optional validation against upstream Labgrid Python APIs
docs/              research, architecture, authoring, and deployment notes
```
