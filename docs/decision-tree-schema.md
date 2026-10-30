# Decision-tree schema

`schemas/use-case.schema.json` is the canonical structural contract. Each YAML
file is one independently loadable use case.

## Top-level fields

| Field | Purpose |
| --- | --- |
| `schemaVersion` | Format version; currently `1` |
| `id` | Stable kebab-case use-case identifier |
| `title`, `description` | Catalog and wizard copy |
| `questions` | Ordered single-choice questions |
| `recommendations` | All compatible approach, topology, and warning results |
| `configurations` | Conditional environment or exporter templates |
| `documentation` | Reusable HTTPS references |

Identifiers and option values use lowercase kebab case. IDs are stable API
values; labels may change without affecting conditions.

## Questions

```yaml
- id: location
  text: Where is the hardware located?
  help: Remote hardware benefits from shared infrastructure.
  options:
    - value: local
      label: Connected to this computer
      description: The controller is local.
    - value: remote-host
      label: Connected to another host
      description: An exporter host is near the hardware.
```

Questions are evaluated in file order. A conditional question must depend on a
question that can already be answered. The validator rejects unknown option
values, cycles, and questions which cannot occur on any answer path.

## Conditions

A condition contains `all`, `any`, or both:

```yaml
when:
  all:
    - question: controller
      equals: network-pdu
  any:
    - question: location
      equals: remote-host
    - question: location
      equals: remote-lab
```

Every `all` predicate must match and at least one `any` predicate must match.
When both are present, both groups must succeed. A predicate uses either
`equals` or `in`:

```yaml
- question: pdu-model
  in: [netio, gude, eaton, apc]
```

This deliberately small language handles the MVP without becoming a generic
rules engine.

## Recommendations

Recommendations have a category (`approach`, `topology`, or `warning`) and a
condition. Every matching recommendation is returned. This allows one path to
combine, for example, a hardware approach, a distributed topology, and a
safety warning.

Each recommendation includes:

- a summary and explicit reasons;
- optional ordered `nextSteps` shown prominently to beginners;
- hardware and software requirements;
- Resource, Driver, Strategy, or infrastructure components;
- an ordered architecture description;
- relevant commands;
- IDs from the top-level documentation list.

The engine also derives an answer trace from the matching predicates so the UI
can explain why a recommendation was selected.

## Configuration templates

Each entry is either an `environment` file or an `exporter` file. Keep those
formats separate.

Use an answer substitution only when an option value is already valid Labgrid
syntax:

```yaml
model: '{{answer:pdu-model}}'
```

Use declared uppercase placeholders for values that must come from the user's
site or hardware:

```yaml
host: '{{PDU_HOST}}'
index: {{PDU_OUTLET_INDEX}}
```

Each placeholder declares a label, explanation, safe example for validation,
and whether it must be replaced. The UI renders unresolved tokens as
`<PDU_HOST>` and marks the file as a template. The semantic validator rejects
undeclared, unused, or unknown answer substitutions.

Templates must remain valid YAML after user-facing placeholder rendering and
after sample substitution. Where possible, the validation script checks their
classes and constructor signatures with the real Labgrid package.

## Semantic checks beyond JSON Schema

The loader rejects:

- duplicate question, option, recommendation, configuration, or documentation
  identifiers;
- unknown questions and invalid option values in conditions;
- circular question dependencies;
- unreachable questions, recommendations, and configurations;
- broken documentation references;
- missing or unused placeholder declarations;
- answer substitutions referring to unknown questions;
- definitions which expand beyond the bounded path-validation limit.
