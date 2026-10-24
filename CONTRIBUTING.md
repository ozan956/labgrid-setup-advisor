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
npm run validate:labgrid
```

Add tests with behavior changes. Engine logic belongs under `src/engine`, UI
behavior under `src/components`, and Labgrid-specific facts in YAML. A new use
case should not need a React conditional.

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

