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

