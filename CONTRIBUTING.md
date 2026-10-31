# Contributing

Contributions should keep recommendations accurate, reviewable, and useful to
someone who does not already know Labgrid's class model.

## Before changing a recommendation

Verify class names, bindings, parameters, external tools, and YAML syntax
against the current upstream Labgrid source. Link the primary source in the
definition or research notes. Do not infer hardware compatibility from a
similar product name.

For electrical guidance, state what is switched: USB VBUS, an external DC path,
or an entire mains outlet. Never recommend voltage, current, polarity, wiring,
or isolation assumptions that are not supplied by the hardware manufacturer.

## Development workflow

```bash
npm install
npm run check
npm test
npm run build
```

When Labgrid is installed, also run:

```bash
PYTHON=/path/to/venv/bin/python LABGRID_REQUIRED=1 npm run validate:labgrid
```

This renders every use-case template and every sample bench and checks them
with the real Labgrid package.

Add tests with behavior changes. Engine logic belongs under `src/engine`,
bench logic under `src/bench`, UI behavior under `src/components`, and
Labgrid-specific facts in YAML. Device facts (USB ids, PDU backends, board
presets) go into `src/data/hardware/`; see
[docs/hardware-catalog.md](docs/hardware-catalog.md). A new use case should
not need a React conditional.

Configuration templates should reuse the shared placeholder tokens
(`PLACE_NAME`, `EXPORT_GROUP`, `SERIAL_NUMBER`, `BAUD_RATE`, `PDU_HOST`, ...)
listed in `src/bench/prefill.ts`, so a bench profile can fill them in.

## Commits

Keep commits small and use short imperative subjects with a useful subsystem
prefix, for example:

```text
power: add a supported PDU path
engine: reject circular question dependencies
docs: explain exporter templates
```

Do not add generated `dist/` output, credentials, private hostnames, or copied
hardware manuals.

## Pull requests

Describe the user path being changed, the upstream revision checked, and which
tests were run. For a new hardware recommendation, include primary evidence for
the Resource, Driver, external dependency, and supported hardware.

