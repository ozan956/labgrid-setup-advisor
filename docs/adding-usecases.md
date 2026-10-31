# Adding a use case

New use cases should usually change YAML and tests, not application components.

## 1. Research upstream

Choose an exact Labgrid revision. Verify every recommended Resource, Driver,
Strategy, binding, parameter, helper program, and configuration shape in source
or current official documentation. Record important version-specific findings.

Check whether an existing utility already solves part of the problem. Reuse or
link to it rather than reproducing host-side discovery in the browser.

## 2. Add the definition

Create `src/data/<use-case-id>.yaml`. Vite discovers YAML files in this
directory automatically. Follow
[decision-tree-schema.md](decision-tree-schema.md) and keep answer IDs stable.

Add a matching entry to `src/data/catalog.yaml` with `status: available`.
Planned entries may be added without a definition, but available entries must
have one.

Keep each question necessary for selecting a materially different result.
Prefer a few explicit predicates over a clever rule graph. Put hardware facts,
explanations, component names, and links in YAML rather than JSX. Facts about
specific devices (USB ids, PDU backends, board presets) belong in
`src/data/hardware/`; see [hardware-catalog.md](hardware-catalog.md).

## 3. Write conservative templates

- Separate exporter resource files from client environment files.
- Preserve real Labgrid nesting and class names.
- Leave serials, udev matches, hosts, outlet indices, place names, credentials,
  and other site data as declared placeholders.
- Reuse the shared placeholder tokens (`PLACE_NAME`, `EXPORT_GROUP`,
  `SERIAL_NUMBER`, `BAUD_RATE`, `PDU_HOST`, `PDU_OUTLET_INDEX`,
  `UDEV_ID_PATH`, `SHELL_PROMPT`, ...) so a bench profile can fill them. The
  full list is in `src/bench/prefill.ts`; see [bench.md](bench.md).
- Do not emit a template when a required backend or electrical path is unknown.
- Explain whether a sample switches USB power, a DC path, or a complete outlet.

## 4. Add tests

At minimum, load the real YAML definition and test:

- one normal local path;
- one distributed path where applicable;
- a changed answer that removes a conditional question;
- unsafe or unsupported combinations;
- recommendation IDs and configuration IDs for reference scenarios;
- YAML parsing for every selected template.

Shared schema and engine cases belong in the existing focused unit tests. The
React test should stay generic unless the user-facing journey changes.

## 5. Verify

```bash
npm run check
npm test
npm run validate:labgrid
npm run build
```

Then inspect desktop and narrow layouts and exercise Previous, Next, editing,
and copy behavior with a keyboard.

## Future upstream data source

Definitions are loaded from source text through `loadDefinition`; the engine
does not know their path. If upstream Labgrid accepts these files, a build step
can fetch or vendor a pinned upstream directory and expose the same source
strings. The schema, engine, and components do not need to move into the Python
repository.

