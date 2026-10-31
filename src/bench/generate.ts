import { stringify } from 'yaml';
import { buildChecklist, exporterResourceNames, namedDeviceIds, resourceClassOf } from './checklist';
import { DEFAULT_COORDINATOR, devicesWithRole, slugify } from './profile';
import type { BenchDevice, BenchProfile, ChecklistStep, GeneratedFile, HardwareCatalog } from './types';

export interface GenerateOptions {
  /** When given, the header of each file records the generation time. Omit for deterministic output. */
  generatedAt?: Date;
}

type Params = Record<string, unknown>;

interface ResourceSpec {
  device: BenchDevice;
  cls: string;
  /** Exporter key and, when named is true, the explicit resource name. */
  name: string;
  /** True when the resource needs an explicit name so drivers can bind to it unambiguously. */
  named: boolean;
  params: Params;
}

interface DriverSpec {
  cls: string;
  params: Params;
  /** Instance name used in the list form, e.g. 'console-a-driver'. */
  name?: string;
  /** Explicit bindings used in the list form, e.g. { port: 'console-a' }. */
  bindings?: Record<string, string>;
}

interface Collector {
  unresolved: Set<string>;
  placeholder(token: string): string;
}

function makeCollector(): Collector {
  const unresolved = new Set<string>();
  return {
    unresolved,
    placeholder(token: string): string {
      unresolved.add(token);
      return `<${token}>`;
    },
  };
}

function text(value: string | undefined, token: string, collector: Collector): string {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : collector.placeholder(token);
}

/** Like text() but keeps surrounding whitespace, which is significant in prompt expressions. */
function verbatim(value: string | undefined, token: string, collector: Collector): string {
  return value && value.trim().length > 0 ? value : collector.placeholder(token);
}

function integer(value: number | undefined, token: string, collector: Collector): number | string {
  return Number.isInteger(value) ? (value as number) : collector.placeholder(token);
}

function matchParams(match: Record<string, string>, collector: Collector, fallbackKey = 'ID_SERIAL_SHORT'): Record<string, string> {
  const entries = Object.entries(match).filter(([key]) => key.trim().length > 0);
  if (entries.length === 0) return { [fallbackKey]: collector.placeholder(fallbackKey.replace(/^@/, '')) };
  const result: Record<string, string> = {};
  for (const [key, value] of entries) {
    result[key] = value.trim().length > 0 ? value.trim() : collector.placeholder(key.replace(/^@/, ''));
  }
  return result;
}

function resourceSpec(device: BenchDevice, collector: Collector): ResourceSpec | undefined {
  const cls = resourceClassOf(device);
  if (!cls) return undefined;
  const base = { device, cls, name: slugify(device.label), named: false };
  switch (device.kind) {
    case 'usb-serial':
      return { ...base, params: { match: matchParams(device.match, collector), speed: integer(device.speed, 'BAUD_RATE', collector) } };
    case 'network-serial':
      return {
        ...base,
        params: {
          host: text(device.host, 'SERIAL_HOST', collector),
          port: integer(device.port, 'SERIAL_PORT', collector),
          speed: integer(device.speed, 'BAUD_RATE', collector),
          protocol: device.protocol,
        },
      };
    case 'network-pdu':
      return {
        ...base,
        params: {
          model: text(device.model, 'PDU_MODEL', collector),
          host: text(device.host, 'PDU_HOST', collector),
          index: integer(device.index, 'PDU_OUTLET_INDEX', collector),
        },
      };
    case 'ykush':
      return { ...base, params: { serial: text(device.serial, 'YKUSH_SERIAL', collector), index: text(device.index, 'YKUSH_PORT_INDEX', collector) } };
    case 'usb-hub-port':
      return { ...base, params: { match: matchParams(device.match, collector, 'ID_PATH'), index: integer(device.index, 'USB_PORT_INDEX', collector) } };
    case 'usb-debugger':
    case 'dfu':
    case 'usb-storage':
    case 'imx-usb-loader':
      return { ...base, params: { match: matchParams(device.match, collector, 'ID_PATH') } };
    case 'usb-sd-mux':
      // USBSDMuxDevice matches the mux's own USB device, and labgrid-suggest prints a direct ID_PATH for it.
      return { ...base, params: { match: matchParams(device.match, collector, 'ID_PATH') } };
    case 'fastboot':
      // udev reports ids in lower case and AndroidUSBFastboot compares them as strings.
      return {
        ...base,
        params: {
          match: matchParams(device.match, collector, 'ID_PATH'),
          usb_vendor_id: text(device.usbId?.vendorId?.toLowerCase(), 'USB_VENDOR_ID', collector),
          usb_product_id: text(device.usbId?.productId?.toLowerCase(), 'USB_PRODUCT_ID', collector),
        },
      };
    case 'network-service':
      return {
        ...base,
        params: {
          address: text(device.address, 'SSH_ADDRESS', collector),
          username: text(device.username, 'SSH_USERNAME', collector),
          port: Number.isInteger(device.port) ? device.port : 22,
        },
      };
    default:
      return undefined;
  }
}

/** Driver class and binding attribute for a device with a resource. */
function driverFor(device: BenchDevice): { cls: string; attribute: string; params: Params } | undefined {
  switch (device.kind) {
    case 'usb-serial':
    case 'network-serial':
      return { cls: 'SerialDriver', attribute: 'port', params: {} };
    case 'network-pdu':
      return { cls: 'NetworkPowerDriver', attribute: 'port', params: {} };
    case 'ykush':
      return { cls: 'YKUSHPowerDriver', attribute: 'port', params: {} };
    case 'usb-hub-port':
      return { cls: 'USBPowerDriver', attribute: 'hub', params: {} };
    case 'usb-debugger': {
      const params: Params = {};
      if (device.interfaceConfig?.trim()) params.interface_config = device.interfaceConfig.trim();
      if (device.boardConfig?.trim()) params.board_config = device.boardConfig.trim();
      return { cls: 'OpenOCDDriver', attribute: 'interface', params };
    }
    case 'dfu':
      return { cls: 'DFUDriver', attribute: 'dfu', params: {} };
    case 'fastboot':
      return { cls: 'AndroidFastbootDriver', attribute: 'fastboot', params: {} };
    case 'usb-sd-mux':
      return { cls: 'USBSDMuxDriver', attribute: 'mux', params: {} };
    case 'usb-storage':
      return { cls: 'USBStorageDriver', attribute: 'storage', params: {} };
    case 'imx-usb-loader':
      return { cls: 'IMXUSBDriver', attribute: 'loader', params: {} };
    case 'network-service':
      return { cls: 'SSHDriver', attribute: 'networkservice', params: {} };
    default:
      return undefined;
  }
}

const POWER_KINDS = new Set<BenchDevice['kind']>(['network-pdu', 'ykush', 'usb-hub-port', 'manual-power']);
const CONSOLE_KINDS = new Set<BenchDevice['kind']>(['usb-serial', 'network-serial']);

/** Devices in the order Labgrid needs them: consoles first, then power, then the rest. */
function orderedDevices(profile: BenchProfile): BenchDevice[] {
  const order: Array<ReturnType<typeof devicesWithRole>> = [
    devicesWithRole(profile, 'console'),
    devicesWithRole(profile, 'power'),
    devicesWithRole(profile, 'debug'),
    devicesWithRole(profile, 'bootstrap'),
    devicesWithRole(profile, 'storage'),
    devicesWithRole(profile, 'network'),
  ];
  return order.flat();
}

interface Plan {
  resources: ResourceSpec[];
  drivers: DriverSpec[];
  /** True when any resource needs an explicit name, which forces the list form. */
  needsNames: boolean;
  names: Map<string, string>;
}

function planTarget(profile: BenchProfile, collector: Collector): Plan {
  const devices = orderedDevices(profile);
  const names = exporterResourceNames(devices);
  const named = namedDeviceIds(devices);
  const resources: ResourceSpec[] = [];
  const drivers: DriverSpec[] = [];

  for (const device of devices) {
    const spec = resourceSpec(device, collector);
    if (spec) {
      spec.name = names.get(device.id) ?? spec.name;
      spec.named = named.has(device.id);
      resources.push(spec);
    }
  }
  const needsNames = resources.some((spec) => spec.named);

  // A manual power entry next to a real controller would give the target two
  // PowerProtocol drivers, which Labgrid rejects as ambiguous. The controller wins.
  const controlledPower = devices.some((device) => POWER_KINDS.has(device.kind) && device.kind !== 'manual-power' && resourceClassOf(device));

  const consoleDrivers: DriverSpec[] = [];
  const powerDrivers: DriverSpec[] = [];
  for (const device of devices) {
    if (device.kind === 'manual-power') {
      if (controlledPower) continue;
      const name = profile.board.name.trim() || profile.names.place.trim() || 'board-01';
      const manual: DriverSpec = { cls: 'ManualPowerDriver', params: { name }, name };
      drivers.push(manual);
      powerDrivers.push(manual);
      continue;
    }
    const spec = resources.find((candidate) => candidate.device.id === device.id);
    const driver = driverFor(device);
    if (!spec || !driver) continue;
    const driverSpec: DriverSpec = {
      cls: driver.cls,
      params: driver.params,
      name: spec.named ? `${spec.name}-driver` : undefined,
      bindings: spec.named ? { [driver.attribute]: spec.name } : undefined,
    };
    drivers.push(driverSpec);
    if (CONSOLE_KINDS.has(device.kind)) consoleDrivers.push(driverSpec);
    if (POWER_KINDS.has(device.kind)) powerDrivers.push(driverSpec);
  }

  // Protocol consumers need explicit bindings only when several suppliers exist.
  // A binding always names a driver instance, never a class, so the referenced
  // driver gets an explicit name if it has none yet.
  const usedNames = new Set(drivers.map((driver) => driver.name).filter((name): name is string => name !== undefined));
  const bindingName = (driver: DriverSpec): string => {
    if (!driver.name) {
      let candidate = slugify(driver.cls);
      let suffix = 2;
      while (usedNames.has(candidate)) candidate = `${slugify(driver.cls)}-${suffix++}`;
      usedNames.add(candidate);
      driver.name = candidate;
    }
    return driver.name;
  };
  const consoleBinding: Record<string, string> = consoleDrivers.length > 1 ? { console: bindingName(consoleDrivers[0]) } : {};
  const powerBinding: Record<string, string> = powerDrivers.length > 1 ? { power: bindingName(powerDrivers[0]) } : {};
  const hasPower = powerDrivers.length > 0;
  // ShellDriver, bootloader drivers and strategies all talk over the console.
  const hasConsole = consoleDrivers.length > 0;

  if (profile.login && hasConsole) {
    drivers.push({
      cls: 'ShellDriver',
      name: 'shell',
      params: {
        prompt: verbatim(profile.login.prompt, 'SHELL_PROMPT', collector),
        login_prompt: verbatim(profile.login.loginPrompt, 'LOGIN_PROMPT', collector),
        username: text(profile.login.username, 'USERNAME', collector),
      },
      bindings: { ...consoleBinding },
    });
  }
  if (profile.bootloader && hasConsole) {
    const uboot = profile.bootloader.kind === 'uboot';
    drivers.push({
      cls: uboot ? 'UBootDriver' : 'BareboxDriver',
      name: uboot ? 'uboot' : 'barebox',
      params: { prompt: verbatim(profile.bootloader.prompt, 'BOOTLOADER_PROMPT', collector) },
      bindings: { ...consoleBinding },
    });
  }
  if (profile.login && hasPower && hasConsole) {
    const uboot = profile.bootloader?.kind === 'uboot';
    const cls = profile.bootloader ? (uboot ? 'UBootStrategy' : 'BareboxStrategy') : 'ShellStrategy';
    drivers.push({ cls, name: 'strategy', params: {}, bindings: { ...consoleBinding, ...powerBinding } });
  }

  return { resources, drivers, needsNames, names };
}

function resourcesValue(plan: Plan): unknown {
  if (plan.needsNames) {
    return plan.resources.map((spec) => ({ [spec.cls]: spec.named ? { name: spec.name, ...spec.params } : spec.params }));
  }
  const value: Params = {};
  for (const spec of plan.resources) value[spec.cls] = spec.params;
  return value;
}

function driversValue(plan: Plan): unknown {
  if (plan.needsNames) {
    return plan.drivers.map((driver) => {
      const params: Params = {};
      if (driver.name && driver.cls !== 'ManualPowerDriver') params.name = driver.name;
      Object.assign(params, driver.params);
      if (driver.bindings && Object.keys(driver.bindings).length > 0) params.bindings = { ...driver.bindings };
      return { [driver.cls]: params };
    });
  }
  const value: Params = {};
  for (const driver of plan.drivers) {
    if (value[driver.cls] !== undefined) continue;
    value[driver.cls] = driver.params;
  }
  return value;
}

/** Placeholder tokens present in a rendered file, e.g. ['ID_PATH']. */
export function unresolvedTokens(content: string): string[] {
  return [...new Set([...content.matchAll(/<([A-Z][A-Z0-9_]*)>/g)].map((match) => match[1]))];
}

/**
 * Exporter files are rendered through Jinja2 before YAML parsing, and Labgrid
 * configures `#` as the Jinja line-statement prefix. A plain `# comment` in an
 * exporter file is therefore a template syntax error; only `##` comments are
 * safe there. Environment files are plain YAML and accept `#`.
 */
function header(profile: BenchProfile, purpose: string, options: GenerateOptions, kind: 'environment' | 'exporter' = 'environment'): string {
  const prefix = kind === 'exporter' ? '##' : '#';
  const lines = [
    `${prefix} Generated by Labgrid Setup Advisor`,
    `${prefix} Purpose: ${purpose}`,
    `${prefix} Board: ${profile.board.name.trim() || 'unnamed board'}`,
    `${prefix} Review every value before use and replace every value written in angle brackets.`,
  ];
  if (kind === 'exporter') {
    lines.push(`${prefix} Keep comments in this file prefixed with '##': labgrid-exporter treats lines starting with a single '#' as Jinja statements.`);
  }
  if (options.generatedAt) lines.push(`${prefix} Generated at: ${options.generatedAt.toISOString()}`);
  return `${lines.join('\n')}\n`;
}

function toYaml(value: unknown): string {
  return stringify(value, { lineWidth: 0, singleQuote: true, aliasDuplicateObjects: false });
}

function names(profile: BenchProfile): { place: string; group: string; exporterHost: string; coordinator: string; location: string } {
  const place = profile.names.place.trim() || 'board-01';
  return {
    place,
    group: profile.names.group.trim() || place,
    exporterHost: profile.names.exporterHost.trim(),
    coordinator: profile.names.coordinator.trim() || DEFAULT_COORDINATOR,
    location: profile.names.location.trim(),
  };
}

function environmentFile(profile: BenchProfile, plan: Plan, options: GenerateOptions): GeneratedFile {
  const target: Params = {};
  if (plan.resources.length > 0) target.resources = resourcesValue(plan);
  target.drivers = driversValue(plan);
  const content = header(profile, 'local environment for pytest and scripts on this computer', options) + toYaml({ targets: { main: target } });
  return {
    filename: 'environment.yaml',
    kind: 'environment',
    title: 'Local environment',
    description: 'Pass this file to pytest with --lg-env or load it with labgrid.Environment. Resources are opened directly on this computer.',
    content,
    target: 'client',
    unresolved: unresolvedTokens(content),
  };
}

function exporterFile(profile: BenchProfile, plan: Plan, options: GenerateOptions): GeneratedFile {
  const { group, location } = names(profile);
  const groupValue: Params = {};
  if (location) groupValue.location = location;
  for (const spec of plan.resources) {
    if (spec.name === spec.cls) groupValue[spec.cls] = spec.params;
    else groupValue[spec.name] = { cls: spec.cls, ...spec.params };
  }
  const content = header(profile, `exporter resources for the ${group} group`, options, 'exporter') + toYaml({ [group]: groupValue });
  return {
    filename: 'exporter.yaml',
    kind: 'exporter',
    title: 'Exporter resources',
    description: 'Copy this file to the machine the hardware is plugged into and start labgrid-exporter with it. Each entry becomes a resource the coordinator can hand out.',
    content,
    target: 'exporter-host',
    unresolved: unresolvedTokens(content),
  };
}

function remoteFile(profile: BenchProfile, plan: Plan, options: GenerateOptions): GeneratedFile {
  const { place } = names(profile);
  const target: Params = {
    resources: { RemotePlace: { name: place } },
    drivers: driversValue(plan),
  };
  const content = header(profile, `client environment for the ${place} place`, options) + toYaml({ targets: { main: target } });
  return {
    filename: 'remote.yaml',
    kind: 'environment',
    title: 'Client environment',
    description: 'Use this on your computer. RemotePlace fetches the resources of the acquired place from the coordinator, so the drivers stay the same as for a local setup.',
    content,
    target: 'client',
    unresolved: unresolvedTokens(content),
  };
}

function overrideFile(profile: BenchProfile): GeneratedFile {
  const { coordinator } = names(profile);
  const content = [
    '# Drop-in for the labgrid-exporter systemd unit.',
    '# Install with: sudo systemctl edit labgrid-exporter.service',
    '# and paste the lines below, or save as',
    '# /etc/systemd/system/labgrid-exporter.service.d/override.conf',
    '[Service]',
    `Environment="LG_COORDINATOR=${coordinator}"`,
    '',
  ].join('\n');
  return {
    filename: 'labgrid-exporter.override.conf',
    kind: 'service',
    title: 'Exporter service drop-in',
    description: 'Points the exporter service at your coordinator. Only needed when the coordinator does not run on the exporter host.',
    content,
    target: 'exporter-host',
    unresolved: [],
  };
}

function describeDevice(device: BenchDevice): string {
  switch (device.kind) {
    case 'usb-serial': return `USB serial console (${device.speed} baud)`;
    case 'network-serial': return `network serial ${device.host || '?'}:${device.port} (${device.protocol})`;
    case 'network-pdu': return `network PDU ${device.model || '?'} at ${device.host || '?'}, outlet ${device.index}`;
    case 'ykush': return `YKUSH ${device.serial || '?'} port ${device.index}`;
    case 'usb-hub-port': return `uhubctl hub port ${device.index}`;
    case 'manual-power': return 'manual power switching';
    case 'usb-debugger': return `debug probe${device.interfaceConfig ? ` (${device.interfaceConfig})` : ''}`;
    case 'dfu': return 'DFU device';
    case 'fastboot': return `fastboot device ${device.usbId.vendorId}:${device.usbId.productId}`;
    case 'usb-sd-mux': return 'USB-SD-Mux';
    case 'usb-storage': return 'USB mass storage';
    case 'imx-usb-loader': return 'i.MX USB loader';
    case 'network-service': return `SSH to ${device.username || '?'}@${device.address || '?'}:${device.port}`;
    case 'unsupported-usb': return `unsupported USB device ${device.usbId.vendorId}:${device.usbId.productId}`;
    default: return 'device';
  }
}

function renderChecklist(steps: ChecklistStep[]): string {
  return steps
    .map((step, index) => {
      const lines = [`${index + 1}. **${step.title}** _(${step.target})_`, '', `   ${step.detail}`];
      if (step.commands?.length) {
        lines.push('', '   ```bash', ...step.commands.flatMap((command) => command.split('\n').map((line) => `   ${line}`)), '   ```');
      }
      if (step.docs?.length) lines.push('', ...step.docs.map((doc) => `   - [${doc.title}](${doc.url})`));
      return lines.join('\n');
    })
    .join('\n\n');
}

function setupFile(profile: BenchProfile, files: GeneratedFile[], steps: ChecklistStep[]): GeneratedFile {
  const { place, group, exporterHost, coordinator, location } = names(profile);
  const rows: Array<[string, string]> = [
    ['Board', profile.board.name.trim() || 'unnamed board'],
    ['Topology', profile.topology === 'remote' ? 'remote (exporter + coordinator)' : 'local (this computer)'],
    ['Sharing', profile.sharing === 'team' ? 'several people or CI' : 'only me'],
    ['Place', place],
    ['Exporter group', group],
    ...(profile.topology === 'remote' ? [['Exporter host', exporterHost || '<EXPORTER_HOST>'] as [string, string]] : []),
    ...(profile.topology === 'remote' ? [['Coordinator', coordinator] as [string, string]] : []),
    ...(location ? [['Location', location] as [string, string]] : []),
  ];
  const unresolved = [...new Set(files.flatMap((file) => file.unresolved))];
  const lines = [
    `# Labgrid setup for ${profile.board.name.trim() || place}`,
    '',
    'Generated by Labgrid Setup Advisor. Review every value before use.',
    '',
    '## Bench summary',
    '',
    '| Item | Value |',
    '| --- | --- |',
    ...rows.map(([key, value]) => `| ${key} | ${value} |`),
    '',
    '## Devices',
    '',
    ...(profile.devices.length > 0 ? profile.devices.map((device) => `- ${device.label}: ${describeDevice(device)}`) : ['- none configured yet']),
    '',
    '## Files in this bundle',
    '',
    ...files.map((file) => `- \`${file.filename}\` (${file.target}): ${file.description}`),
    '',
    ...(unresolved.length > 0
      ? ['## Placeholders to replace', '', ...unresolved.map((token) => `- \`<${token}>\``), '']
      : []),
    '## Step by step',
    '',
    renderChecklist(steps),
    '',
  ];
  return {
    filename: 'SETUP.md',
    kind: 'notes',
    title: 'Setup notes',
    description: 'Human-readable summary of the bench and the ordered steps to bring it up.',
    content: lines.join('\n'),
    target: 'client',
    unresolved: [],
  };
}

function profileFile(profile: BenchProfile): GeneratedFile {
  return {
    filename: 'bench-profile.json',
    kind: 'profile',
    title: 'Bench profile',
    description: 'Import this file into the advisor later to continue editing the same bench.',
    content: `${JSON.stringify(profile, null, 2)}\n`,
    target: 'client',
    unresolved: [],
  };
}

/**
 * Turn a bench profile into the set of files a user needs: Labgrid YAML for
 * the chosen topology, an optional systemd drop-in, setup notes, and the
 * profile itself for re-import.
 */
export function generateBenchFiles(profile: BenchProfile, catalog: HardwareCatalog, options: GenerateOptions = {}): GeneratedFile[] {
  const collector = makeCollector();
  const plan = planTarget(profile, collector);
  const files: GeneratedFile[] = [];

  if (profile.topology === 'remote') {
    files.push(exporterFile(profile, plan, options));
    files.push(remoteFile(profile, plan, options));
    if (names(profile).coordinator !== DEFAULT_COORDINATOR) files.push(overrideFile(profile));
  } else {
    files.push(environmentFile(profile, plan, options));
  }

  const steps = buildChecklist(profile, catalog, files);
  const notes = setupFile(profile, files, steps);
  const profileJson = profileFile(profile);
  return [...files, notes, profileJson];
}
