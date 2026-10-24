# Labgrid Setup Advisor

Labgrid Setup Advisor turns a hardware goal into a reviewed Labgrid setup. It
asks one question at a time, recommends real Resources and Drivers, explains
the topology, and generates conservative YAML templates with explicit hardware
placeholders.

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
  `RemotePlace`.

Every workflow produces reviewed component guidance, topology advice, commands,
and conservative Labgrid YAML templates with explicit site-specific placeholders.

## Why it exists

Labgrid's reference documentation describes individual components well, but a
new user often starts with a goal rather than a class name. This project keeps
that goal-oriented guidance in reviewable YAML and renders it in a standalone
static application. It complements `labgrid-suggest`: the upstream utility
discovers udev matches for attached USB devices, while this advisor chooses an
architecture and component set.

Research and recommendations target upstream commit
`eb05ee6730c0896ec90327ed9b49c93ecd4a5c13`
(`v26.0-216-geb05ee67`). See [docs/research.md](docs/research.md).

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

`npm run validate:labgrid` renders every configuration with safe sample values
and validates it against an installed Labgrid package or a sibling upstream
checkout. Set `LABGRID_REQUIRED=1` in CI when Labgrid must be present.

The production site is written to `dist/` and needs only static hosting.

## How decision trees work

YAML definitions under `src/data/` contain questions, conditions,
recommendations, configuration templates, commands, and documentation links.
Vite discovers definition files automatically. The loader validates each file
with `schemas/use-case.schema.json` plus semantic checks before the UI can use
it.

The TypeScript engine in `src/engine/` is independent of React. It determines
visible questions, reconciles changed answers, selects every matching
recommendation, and renders configurations. React components do not contain
Labgrid-specific decision branches.

To add a use case, add its YAML definition and a catalog entry, then add path
tests. See [docs/adding-usecases.md](docs/adding-usecases.md) and
[docs/decision-tree-schema.md](docs/decision-tree-schema.md).

## Configuration safety

Generated files are templates, not universal configurations. Hardware-specific
values remain as angle-bracket placeholders and the result page marks the file
as not ready to run. The advisor never stores credentials, probes hardware, or
claims that an unverified PDU or ordinary USB hub is compatible.

Exporter resource YAML and client environment YAML are presented as different
files. Remote resources still need a configured place and the operational
access described by upstream Labgrid documentation.

## Architecture boundary

The web application owns parsing, decision evaluation, and presentation. The
definitions are build inputs with no frontend imports or React concepts. They
can later move into the upstream Labgrid repository and be fetched or vendored
at build time without changing the engine API.

See [docs/architecture.md](docs/architecture.md) for the complete boundary and
[CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow.

## Project layout

```text
schemas/       JSON Schema for use-case definitions
src/data/      YAML catalog and decision definitions
src/engine/    framework-independent validation and decision logic
src/components generic React presentation components
tests/         schema, engine, generator, definition, and journey tests
scripts/       optional validation against upstream Labgrid Python APIs
docs/          research, architecture, authoring, and deployment notes
```
