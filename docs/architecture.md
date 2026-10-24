# Architecture

Labgrid Setup Advisor is a static React application with three explicit
boundaries.

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

The framework-independent TypeScript engine:

- exposes the next visible unanswered question;
- validates answers against visible options;
- prunes answers that become hidden after an earlier answer changes;
- reports missing and inconsistent answers;
- returns every matching recommendation with a human-readable answer trace;
- selects configuration templates and renders answer substitutions;
- reports every unresolved hardware placeholder.

Conditions deliberately support only `all` and `any` lists of simple
single-choice predicates. That is enough for the first use case and keeps the
format reviewable. A general rule language is intentionally out of scope.

## Presentation

React renders the catalog and selected definition. Components receive generic
question, recommendation, architecture, and configuration models; there is no
Labgrid branching logic in JSX. The browser performs no network calls and
stores no data outside component state.

The UI is a small state flow:

```text
landing -> use-case catalog -> question wizard -> recommendations
                               ^                  |
                               +------ edit ------+
```

Changing an earlier answer asks the engine to reconcile the answer set before
the wizard continues. The result page marks templates with unresolved values
as templates rather than ready-to-run configurations.

## Deployment

Vite emits static assets. GitHub Pages, Cloudflare Pages, or any static file
host can serve `dist/`; no server routes, database, authentication, or runtime
secrets are involved. Relative asset paths keep project-subpath hosting viable.

## Repository layout

```text
schemas/                  JSON Schema for use-case YAML
src/data/                 catalog and use-case YAML
src/engine/               loader, semantic validator, engine, generator
src/components/           generic presentation components
tests/                    engine, schema, generator, and user-flow tests
scripts/                  optional upstream Labgrid validation
docs/                     research and contributor documentation
```

## Trust boundaries

Decision YAML is untrusted input even when bundled. It is parsed safely,
validated structurally, then checked semantically before rendering. Generated
YAML is escaped only through authored templates, so definitions are code-review
artifacts. Documentation URLs are restricted by schema to HTTPS. The app never
executes generated commands or configurations.

## Deliberate limits

- One complete use case: remote power control.
- Single-choice questions only.
- Placeholder templates rather than credential collection.
- No live hardware probing; `labgrid-suggest` remains the correct local tool.
- No strategy recommendation for power-only flows because upstream does not
  require one.

