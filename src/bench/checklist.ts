import { DEFAULT_COORDINATOR, deviceRole, devicesWithRole, slugify } from './profile';
import type { BenchDevice, BenchProfile, ChecklistStep, GeneratedFile, HardwareCatalog } from './types';

const DOCS = {
  gettingStarted: { title: 'Labgrid getting started', url: 'https://labgrid.readthedocs.io/en/latest/getting_started.html' },
  exporter: { title: 'labgrid-exporter manual', url: 'https://labgrid.readthedocs.io/en/latest/man/exporter.html' },
  client: { title: 'labgrid-client manual', url: 'https://labgrid.readthedocs.io/en/latest/man/client.html' },
  suggest: { title: 'labgrid-suggest manual', url: 'https://labgrid.readthedocs.io/en/latest/man/suggest.html' },
  usage: { title: 'Labgrid usage and reservations', url: 'https://labgrid.readthedocs.io/en/latest/usage.html' },
  configuration: { title: 'Labgrid configuration reference', url: 'https://labgrid.readthedocs.io/en/latest/configuration.html' },
  uhubctl: { title: 'uhubctl compatible hubs', url: 'https://github.com/mvp/uhubctl' },
};

interface ToolNeed {
  tool: string;
  install: string;
  reason: string;
}

function toolNeeds(devices: BenchDevice[], remote: boolean): ToolNeed[] {
  const kinds = new Set(devices.map(({ kind }) => kind));
  const needs: ToolNeed[] = [];
  if (kinds.has('usb-hub-port')) {
    needs.push({ tool: 'uhubctl', install: 'sudo apt install uhubctl', reason: 'USBPowerDriver switches hub ports with uhubctl.' });
  }
  if (kinds.has('ykush')) {
    needs.push({ tool: 'ykushcmd', install: '# build ykushcmd from https://github.com/Yepkit/ykush and put it on PATH', reason: 'YKUSHPowerDriver calls ykushcmd.' });
  }
  if (kinds.has('usb-sd-mux')) {
    needs.push({ tool: 'usbsdmux', install: 'pip install usbsdmux', reason: 'USBSDMuxDriver calls usbsdmux.' });
  }
  if (kinds.has('usb-debugger')) {
    needs.push({ tool: 'openocd', install: 'sudo apt install openocd', reason: 'OpenOCDDriver runs openocd.' });
  }
  if (kinds.has('dfu')) {
    needs.push({ tool: 'dfu-util', install: 'sudo apt install dfu-util', reason: 'DFUDriver runs dfu-util.' });
  }
  if (kinds.has('fastboot')) {
    needs.push({ tool: 'fastboot', install: 'sudo apt install fastboot', reason: 'AndroidFastbootDriver runs fastboot.' });
  }
  if (kinds.has('imx-usb-loader')) {
    needs.push({ tool: 'imx-usb-loader', install: '# build imx-usb-loader from the barebox sources (scripts/imx): https://github.com/barebox/barebox', reason: 'IMXUSBDriver runs the imx-usb-loader tool from barebox (BDIMXUSBDriver would use imx_usb by Boundary Devices instead)' });
  }
  if (remote && kinds.has('usb-serial')) {
    needs.push({ tool: 'ser2net', install: 'sudo apt install ser2net', reason: 'The exporter shares USB serial ports through ser2net.' });
  }
  return needs;
}

function pduRequirements(profile: BenchProfile, catalog: HardwareCatalog): string[] {
  const requirements = new Set<string>();
  for (const device of profile.devices) {
    if (device.kind !== 'network-pdu') continue;
    const entry = catalog.pduModels.find((model) => model.model === device.model);
    for (const requirement of entry?.requirements ?? []) requirements.add(requirement);
  }
  return [...requirements];
}

function coordinatorFlag(profile: BenchProfile): string {
  return profile.names.coordinator && profile.names.coordinator !== DEFAULT_COORDINATOR ? ` -x ${profile.names.coordinator}` : '';
}

function sameClassGroups(devices: BenchDevice[]): Map<string, BenchDevice[]> {
  const groups = new Map<string, BenchDevice[]>();
  for (const device of devices) {
    const cls = resourceClassOf(device);
    if (!cls) continue;
    groups.set(cls, [...(groups.get(cls) ?? []), device]);
  }
  return groups;
}

/** Resource class exported for a device, or undefined when the device has no resource. */
export function resourceClassOf(device: BenchDevice): string | undefined {
  switch (device.kind) {
    case 'usb-serial': return 'USBSerialPort';
    case 'network-serial': return 'NetworkSerialPort';
    case 'network-pdu': return 'NetworkPowerPort';
    case 'ykush': return 'YKUSHPowerPort';
    case 'usb-hub-port': return 'USBPowerPort';
    case 'usb-debugger': return device.resourceClass ?? 'USBDebugger';
    case 'dfu': return 'DFUDevice';
    case 'fastboot': return 'AndroidUSBFastboot';
    case 'usb-sd-mux': return 'USBSDMuxDevice';
    case 'usb-storage': return 'USBMassStorage';
    case 'imx-usb-loader': return 'IMXUSBLoader';
    case 'network-service': return 'NetworkService';
    default: return undefined;
  }
}

/**
 * Devices whose resources need explicit names and bindings: a class that
 * repeats, or several consoles or several power controls, because protocol
 * consumers such as ShellDriver and strategies would otherwise be ambiguous.
 */
export function namedDeviceIds(devices: BenchDevice[]): Set<string> {
  const named = new Set<string>();
  for (const group of sameClassGroups(devices).values()) {
    if (group.length > 1) for (const device of group) named.add(device.id);
  }
  for (const role of ['console', 'power'] as const) {
    const members = devices.filter((device) => deviceRole(device) === role && resourceClassOf(device));
    if (members.length > 1) for (const device of members) named.add(device.id);
  }
  return named;
}

/** Resource names as written into the exporter file: the class name for unnamed resources, a unique slug for named ones. */
export function exporterResourceNames(devices: BenchDevice[]): Map<string, string> {
  const names = new Map<string, string>();
  const named = namedDeviceIds(devices);
  const used = new Set<string>();
  for (const device of devices) {
    const cls = resourceClassOf(device);
    if (!cls) continue;
    if (!named.has(device.id)) {
      names.set(device.id, cls);
      used.add(cls);
    }
  }
  for (const device of devices) {
    if (!named.has(device.id) || !resourceClassOf(device)) continue;
    let slug = slugify(device.label);
    let suffix = 2;
    while (used.has(slug)) slug = `${slugify(device.label)}-${suffix++}`;
    used.add(slug);
    names.set(device.id, slug);
  }
  return names;
}

interface StepContext {
  remote: boolean;
  /** Environment file name used in commands and prose. */
  envName: string;
}

function contextFor(profile: BenchProfile, files: GeneratedFile[], envNameOverride?: string): StepContext {
  const remote = profile.topology === 'remote';
  const envFile = files.find((file) => file.kind === 'environment');
  return { remote, envName: envNameOverride ?? envFile?.filename ?? (remote ? 'remote.yaml' : 'environment.yaml') };
}

/**
 * Steps that happen once per exporter host and coordinator: installation,
 * helper tools, device permissions, placeholders, coordinator and exporter
 * start-up. For a lab, pass a profile whose devices are the union of all
 * benches and `envNameOverride` to speak about "each environment file".
 */
export function sharedChecklistSteps(profile: BenchProfile, catalog: HardwareCatalog, files: GeneratedFile[], envNameOverride?: string): ChecklistStep[] {
  const steps: ChecklistStep[] = [];
  const { remote, envName } = contextFor(profile, files, envNameOverride);
  const exporterHost = profile.names.exporterHost.trim() || '<EXPORTER_HOST>';
  const nonDefaultCoordinator = profile.names.coordinator && profile.names.coordinator !== DEFAULT_COORDINATOR;
  const usbDevices = profile.devices.filter((device) => 'match' in device);
  const unresolved = [...new Set(files.flatMap((file) => file.unresolved))];
  const COMMAND_LIKE = /^(pip|pip3|python3?|sudo|apt|apt-get|dnf|brew|export)\b/;
  const extras = pduRequirements(profile, catalog);
  const extraCommands = extras.filter((requirement) => COMMAND_LIKE.test(requirement));
  const extraNotes = extras.filter((requirement) => !COMMAND_LIKE.test(requirement));

  steps.push({
    id: 'install-labgrid',
    title: remote ? 'Install Labgrid on the exporter host and on your computer' : 'Install Labgrid',
    detail: [
      remote
        ? 'Both machines need the same Labgrid version. A virtual environment keeps it separate from system Python.'
        : 'A virtual environment keeps Labgrid separate from system Python. Activate it in every new terminal.',
      ...(extraNotes.length > 0 ? [`Your power controller also needs: ${extraNotes.join('; ')}.`] : []),
    ].join(' '),
    target: remote ? 'anywhere' : 'client',
    commands: [
      'python3 -m venv labgrid-venv',
      '. labgrid-venv/bin/activate',
      'pip install --upgrade pip',
      'pip install labgrid',
      ...extraCommands,
    ],
    docs: [DOCS.gettingStarted],
  });

  const tools = toolNeeds(profile.devices, remote);
  if (tools.length > 0) {
    steps.push({
      id: 'install-tools',
      title: remote ? 'Install helper tools on the exporter host' : 'Install helper tools',
      detail: `Labgrid drivers call external programs for your hardware: ${tools.map((need) => `${need.tool} (${need.reason.replace(/\.$/, '')})`).join('; ')}. Put each tool on PATH or point to it under the tools: key of ${envName}.`,
      target: remote ? 'exporter-host' : 'client',
      commands: tools.map((need) => need.install),
      docs: [DOCS.configuration, ...(tools.some((need) => need.tool === 'uhubctl') ? [DOCS.uhubctl] : [])],
    });
  }

  if (usbDevices.length > 0) {
    steps.push({
      id: 'device-access',
      title: 'Allow your user to open the USB devices',
      detail: 'Serial ports belong to the dialout group on most distributions. Log out and back in after changing groups. Debug probes and hubs may also need udev rules from their vendor.',
      target: remote ? 'exporter-host' : 'client',
      commands: ['sudo usermod -a -G dialout $USER', 'ls -l /dev/ttyUSB* /dev/ttyACM* 2>/dev/null'],
    });
  }

  if (unresolved.length > 0) {
    steps.push({
      id: 'fill-placeholders',
      title: `Replace ${unresolved.length} placeholder value${unresolved.length === 1 ? '' : 's'} in the generated files`,
      detail: `The files still contain ${unresolved.map((token) => `<${token}>`).join(', ')}. Run labgrid-suggest while plugging the device in, or inspect it with udevadm, and copy the match values into the file.`,
      target: remote ? 'exporter-host' : 'client',
      commands: ['labgrid-suggest', 'udevadm info /dev/ttyUSB0 | grep -E "ID_SERIAL_SHORT|ID_PATH|ID_USB_INTERFACE_NUM"'],
      docs: [DOCS.suggest],
    });
  }

  if (remote) {
    steps.push({
      id: 'start-coordinator',
      title: 'Start the coordinator',
      detail: `The coordinator keeps track of places and who holds them. It listens on port 20408. Your configuration points at ${profile.names.coordinator || DEFAULT_COORDINATOR}. For a permanent setup, install the systemd unit from the Labgrid contrib directory.`,
      target: 'coordinator-host',
      commands: ['labgrid-coordinator'],
      docs: [DOCS.gettingStarted],
    });
    steps.push({
      id: 'start-exporter',
      title: `Start the exporter on ${exporterHost}`,
      detail: `Copy exporter.yaml to the exporter host and start labgrid-exporter with the name used in the place matches. ${nonDefaultCoordinator ? 'LG_COORDINATOR tells it where the coordinator runs.' : 'It connects to the coordinator on localhost by default.'} For a permanent setup, use the systemd unit and /etc/labgrid/exporter.yaml.`,
      target: 'exporter-host',
      commands: [
        nonDefaultCoordinator
          ? `LG_COORDINATOR=${profile.names.coordinator} labgrid-exporter -n ${exporterHost} exporter.yaml`
          : `labgrid-exporter -n ${exporterHost} exporter.yaml`,
      ],
      docs: [DOCS.exporter],
    });
    steps.push({
      id: 'check-resources',
      title: 'Check that the coordinator sees your resources',
      detail: 'Every resource from exporter.yaml should appear with the exporter name and group. If one is missing, check the exporter log for a match that did not find a device.',
      target: 'client',
      commands: [`labgrid-client${coordinatorFlag(profile)} resources`],
      docs: [DOCS.client],
    });
  }

  return steps;
}

/**
 * Steps that belong to one board: creating and trying its place (remote) or
 * exercising its environment file (local). `files` should be the files of
 * this bench only, so the environment file name is the right one.
 */
export function benchChecklistSteps(profile: BenchProfile, files: GeneratedFile[]): ChecklistStep[] {
  const steps: ChecklistStep[] = [];
  const { remote, envName } = contextFor(profile, files);
  const place = profile.names.place.trim() || 'board-01';
  const group = profile.names.group.trim() || place;
  const exporterHost = profile.names.exporterHost.trim() || '<EXPORTER_HOST>';
  const consoles = devicesWithRole(profile, 'console');
  const power = devicesWithRole(profile, 'power');

  if (remote) {
    const names = exporterResourceNames(profile.devices);
    const named = namedDeviceIds(profile.devices);
    steps.push({
      id: 'create-place',
      title: `Create the place ${place} and attach the resources`,
      detail: named.size > 0
        ? `A place groups the resources of one board. The wildcard match takes every resource from your exporter group; the resource names used in the bindings of ${envName} come from the keys in exporter.yaml, so no extra match is needed.`
        : 'A place groups the resources of one board. The wildcard match takes every resource from your exporter group.',
      target: 'client',
      commands: [
        `labgrid-client${coordinatorFlag(profile)} -p ${place} create`,
        `labgrid-client${coordinatorFlag(profile)} -p ${place} add-match ${exporterHost}/${group}/*`,
      ],
      docs: [DOCS.client],
    });
    // With several consoles or power controls, labgrid-client needs the resource name.
    const consoleName = consoles.length > 1 ? names.get(consoles[0].id) : undefined;
    const powerResources = power.filter((device) => resourceClassOf(device));
    const powerName = powerResources.length > 1 ? names.get(powerResources[0].id) : undefined;
    steps.push({
      id: 'acquire',
      title: 'Acquire the place and try it',
      detail: `Acquiring locks the board for you. Release it when you are done so colleagues and CI can use it.${consoleName || powerName ? ' Because several resources of the same kind exist, the commands name the one to use.' : ''}`,
      target: 'client',
      commands: [
        `labgrid-client${coordinatorFlag(profile)} -p ${place} acquire`,
        ...(consoles.length > 0 ? [`labgrid-client${coordinatorFlag(profile)} -p ${place} console${consoleName ? ` ${consoleName}` : ''}`] : []),
        ...(powerResources.length > 0 || power.length > 0 ? [`labgrid-client${coordinatorFlag(profile)} -p ${place} power cycle${powerName ? ` ${powerName}` : ''}`] : []),
        `labgrid-client${coordinatorFlag(profile)} -p ${place} release`,
      ],
      docs: [DOCS.client],
    });
    if (profile.sharing === 'team') {
      const tag = slugify(profile.board.name || place);
      steps.push({
        id: 'share',
        title: 'Tag the place so colleagues and CI can reserve it',
        detail: 'Tags let a reservation ask for any board of a kind instead of a fixed place. reserve --shell prints an export line for LG_RESERVATION; after eval, "+" stands for the reserved place in every labgrid-client command.',
        target: 'client',
        commands: [
          `labgrid-client${coordinatorFlag(profile)} -p ${place} set-tags board=${tag}`,
          `eval "$(labgrid-client${coordinatorFlag(profile)} reserve --wait --shell board=${tag})"`,
          `labgrid-client${coordinatorFlag(profile)} -p + acquire`,
          ...(consoles.length > 0 ? [`labgrid-client${coordinatorFlag(profile)} -p + console`] : []),
          `labgrid-client${coordinatorFlag(profile)} -p + release`,
        ],
        docs: [DOCS.usage],
      });
    }
    steps.push({
      id: 'run-tests',
      title: `Use ${envName} from pytest or scripts`,
      detail: 'The client environment file points at the place and lists the drivers. Acquire the place first, then run pytest with the Labgrid plugin.',
      target: 'client',
      commands: [
        `labgrid-client${coordinatorFlag(profile)} -c ${envName} acquire`,
        `pytest --lg-env ${envName} -v`,
        `labgrid-client${coordinatorFlag(profile)} -c ${envName} release`,
      ],
      docs: [DOCS.usage],
    });
  } else {
    const snippet = [
      'from labgrid import Environment',
      `env = Environment('${envName}')`,
      'target = env.get_target()',
      ...(power.length > 0
        ? ["power = target.get_driver('PowerProtocol')", 'power.cycle()']
        : []),
      ...(consoles.length > 0
        ? [
            "console = target.get_driver('ConsoleProtocol')",
            'try:',
            '    print(console.read(timeout=5))',
            'except Exception as error:  # a quiet console raises a timeout',
            "    print('no console output within 5 s:', error)",
          ]
        : []),
    ];
    steps.push({
      id: 'try-environment',
      title: `Try ${envName} from Python`,
      detail: 'Local resources are used directly without a coordinator. This snippet instantiates the target and exercises the drivers you configured.',
      target: 'client',
      commands: [`python3 - <<'EOF'\n${snippet.join('\n')}\nEOF`],
      docs: [DOCS.gettingStarted],
    });
    steps.push({
      id: 'run-tests',
      title: 'Run your first pytest test against the board',
      detail: 'The Labgrid pytest plugin provides the target fixture. Start with the shell example from the Labgrid repository and adapt the prompt values.',
      target: 'client',
      commands: [`pytest --lg-env ${envName} -v`],
      docs: [DOCS.usage],
    });
  }

  return steps;
}

/** The closing step: verify and commit the files. */
export function verifyChecklistStep(): ChecklistStep {
  return {
    id: 'verify',
    title: 'Verify and keep the files under version control',
    detail: 'Once the console shows boot messages and power control works, commit the YAML files next to your tests. Keep credentials out of the files and use placeholders or environment variables instead.',
    target: 'anywhere',
  };
}

export function buildChecklist(profile: BenchProfile, catalog: HardwareCatalog, files: GeneratedFile[]): ChecklistStep[] {
  return [...sharedChecklistSteps(profile, catalog, files), ...benchChecklistSteps(profile, files), verifyChecklistStep()];
}
