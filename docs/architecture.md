# Architecture

Labgrid Setup Advisor is a static React application with four explicit
boundaries: decision definitions, the decision engine, the bench library, and
presentation.

## Decision definitions

Human-reviewed YAML files describe questions, answer options, recommendations,
configuration templates, commands, and documentation links. JSON Schema covers
the transport shape; a small semantic validator checks cross-references,
condition values, duplicate identifiers, cycles, and reachability.

Definitions are imported as text and passed to the loader. The decision engine
has no knowledge of their filesystem location. Moving these files to the
upstream Labgrid repository later requires changing only the build-time data
source, not engine or UI behavior.

## Decision engine

The framework-independent TypeScript engine (`src/engine/`):

- exposes the next visible unanswered question;
- validates answers against visible options;
- prunes answers that become hidden after an earlier answer changes;
- reports missing and inconsistent answers;
- returns every matching recommendation with a human-readable answer trace;
- selects configuration templates and renders answer substitutions;
- substitutes supplied placeholder values, quoting them safely, and reports
  every required placeholder that is still unresolved.

Conditions deliberately support only `all` and `any` lists of simple
single-choice predicates. That is enough for the current workflows and keeps
the format reviewable. A general rule language is intentionally out of scope.

## Bench library

`src/bench/` turns a description of the user's hardware into advice and files.
It is also independent of React:

- `types.ts` and `profile.ts` define the `BenchProfile` and helpers;
- `catalog.ts` loads the reviewed hardware YAML under `src/data/hardware/`
  with JSON Schema and semantic checks;
- `parsers/` read `lsusb`, `udevadm info`, and `labgrid-suggest` output, and
  `detect.ts` turns the records into device candidates with a confidence;
- `insights.ts` evaluates hardware-aware rules;
- `generate.ts`, `checklist.ts`, and `zip.ts` produce exporter, environment,
  systemd, and checklist files and a dependency-free ZIP bundle;
- `prefill.ts` maps a profile to wizard answers and placeholder values;
- `storage.ts` persists the profile in localStorage and in share links, and
  validates imported JSON against `schemas/bench-profile.schema.json`.

The hardware catalog is data in the same sense as the decision definitions:
adding a USB id, PDU backend, or board preset is a YAML review, not a code
change. See [bench.md](bench.md) and [hardware-catalog.md](hardware-catalog.md).

## Presentation

React renders the catalog, the bench editor and plan, and the selected
definition. Components receive generic question, recommendation,
architecture, configuration, insight, file, and checklist models; there is no
Labgrid branching logic in JSX. The browser performs no network calls and
stores only the theme (`labgrid-advisor-theme`), the bench profile
(`labgrid-advisor-bench`), and checklist progress per place
(`labgrid-advisor-checklist:<place>`) in localStorage.

The UI is a small state flow:

```text
landing ---------------------------> use-case wizard -> recommendations
  |   \                                 ^      ^           |     ^
  |    +-> bench editor -> bench plan --+      +--- edit --+     |
  |            ^              |  (open a guide with pre-filled    |
  +------------+--------------+   answers; placeholder values ---+
                                  come from the bench)
```

Changing an earlier answer asks the engine to reconcile the answer set before
the wizard continues. The result page marks templates with unresolved values
as templates rather than ready-to-run configurations, and marks them ready
once every required value is filled in from the bench or by hand.

## Deployment

Vite emits static assets. GitHub Pages, Cloudflare Pages, or any static file
host can serve `dist/`; no server routes, database, authentication, or runtime
secrets are involved. Relative asset paths keep project-subpath hosting viable.

## Repository layout

```text
schemas/                  JSON Schema for use-case YAML, hardware YAML, and bench profiles
src/data/                 catalog and use-case YAML
src/data/hardware/        USB ids, PDU backends, board presets
src/engine/               loader, semantic validator, engine, generator
src/bench/                bench profile library: catalog, parsers, insights, generators
src/components/           generic presentation components
tests/                    engine, schema, generator, bench, and user-flow tests
scripts/                  optional upstream Labgrid validation
docs/                     research and contributor documentation
```

## Trust boundaries

Decision YAML and hardware YAML are untrusted input even when bundled. They are
parsed safely, validated structurally, then checked semantically before
rendering. Generated YAML is escaped only through authored templates or built
from objects with the `yaml` serializer, so definitions are code-review
artifacts. Documentation URLs are restricted by schema to HTTPS.

Pasted command output is parsed with line-oriented parsers and the `yaml`
parser; it is never executed, and only the recognized fields are kept.
Imported bench JSON and share links are validated against the bench profile
schema, which rejects unknown fields, and are otherwise discarded. The app
never executes generated commands or configurations and never collects
credentials.

## Deliberate limits

- Seven focused setup workflows, not a complete hardware compatibility matrix.
- Single-choice questions only.
- Placeholder templates and bench values rather than credential collection.
- No live hardware probing; the user pastes `lsusb`, `udevadm info`, or
  `labgrid-suggest` output, and `labgrid-suggest` remains the authoritative
  local tool.
- A generic boot strategy only when console, power, and login are all known.
