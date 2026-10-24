#!/usr/bin/env python3
import inspect
import io
import json
import os
import sys
from contextlib import redirect_stdout

try:
    from labgrid import Environment, target_factory
    from labgrid.config import Config
    from labgrid.remote.common import ResourceEntry
    from labgrid.remote.config import ResourceConfig
    from labgrid.remote.exporter import ResourceExport, exports
    from labgrid.resource.common import ManagedResource
except ImportError as error:
    if os.environ.get("LABGRID_REQUIRED") == "1":
        raise
    print(f"Labgrid Python validation skipped: {error}")
    raise SystemExit(0)


def validate_signature(cls, name, arguments):
    inspect.signature(cls).bind(None, name, **arguments)


def validate_environment(path):
    config = Config(path)
    for target_config in config.get_targets().values():
        resources = target_factory._convert_to_named_list(target_config.get("resources", {}))
        drivers = target_factory._convert_to_named_list(target_config.get("drivers", {}))
        has_runtime_dependency = False
        for item in resources:
            item = item.copy()
            cls_name = item.pop("cls")
            name = item.pop("name", None)
            resource_cls = target_factory.resources[cls_name]
            has_runtime_dependency |= issubclass(resource_cls, ManagedResource)
            validate_signature(resource_cls, name, item)
        for item in drivers:
            item = item.copy()
            cls_name = item.pop("cls")
            name = item.pop("name", None)
            item.pop("bindings", None)
            validate_signature(target_factory.drivers[cls_name], name, item)

        # Managed resources may need a live coordinator, udev monitor, or other
        # host facility. Signatures above still verify their real classes.
        if not has_runtime_dependency:
            environment = Environment(path)
            environment.get_target()
            environment.cleanup()


def validate_exporter(path):
    with redirect_stdout(io.StringIO()):
        data = ResourceConfig(path).data
    for group in data.values():
        for resource_name, raw_params in group.items():
            if resource_name == "location" or raw_params is None:
                continue
            params = raw_params.copy()
            cls_name = params.pop("cls", resource_name)
            resource_cls = target_factory.resources[cls_name]
            validate_signature(resource_cls, None, params)
            export_cls = exports.get(cls_name)
            if (
                export_cls
                and issubclass(export_cls, ResourceExport)
                and not issubclass(resource_cls, ManagedResource)
            ):
                export_cls(
                    {"avail": False, "cls": cls_name, "params": params},
                    host="validator",
                )
            elif export_cls is ResourceEntry or issubclass(resource_cls, ManagedResource):
                continue


def main():
    with open(sys.argv[1], encoding="utf-8") as manifest_file:
        manifest = json.load(manifest_file)
    for entry in manifest:
        if entry["kind"] == "environment":
            validate_environment(entry["path"])
        else:
            validate_exporter(entry["path"])
    print(f"Validated {len(manifest)} generated templates with Labgrid")


if __name__ == "__main__":
    main()
