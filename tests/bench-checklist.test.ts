import { describe, expect, it } from 'vitest';
import { buildChecklist, exporterResourceNames, resourceClassOf } from '../src/bench/checklist';
import { generateBenchFiles } from '../src/bench/generate';
import { emptyProfile } from '../src/bench/profile';
import type { BenchProfile, HardwareCatalog } from '../src/bench/types';

const catalog: HardwareCatalog = {
  usbDevices: [],
  boards: [],
  pduModels: [
    { model: 'netio', family: 'NETIO 4', indexBase: 1, hostFormat: 'host', confidence: 'source' },
    { model: 'eaton', family: 'Eaton ePDU', indexBase: 1, hostFormat: 'host', requirements: ['pip install "labgrid[snmp]"'], confidence: 'source' },
  ],
};

function remoteProfile(): BenchProfile {
  return {
    ...emptyProfile(),
    board: { name: 'i.MX 8M Mini EVK' },
    topology: 'remote',
    sharing: 'team',
    names: { place: 'imx8mm-01', group: 'imx8mm-01', exporterHost: 'labhost', coordinator: 'coordinator.lab:20408', location: '' },
    devices: [
      { id: 'dev-1', kind: 'usb-serial', label: 'Console', match: { ID_SERIAL_SHORT: 'A50285BI' }, speed: 115200 },
      { id: 'dev-2', kind: 'network-pdu', label: 'PDU', model: 'eaton', host: 'pdu.lab', index: 4 },
      { id: 'dev-3', kind: 'usb-sd-mux', label: 'SD mux', match: { '@ID_PATH': 'pci-0000:00:14.0-usb-0:1.2' } },
    ],
  };
}

const ids = (steps: ReturnType<typeof buildChecklist>) => steps.map((step) => step.id);
const commands = (steps: ReturnType<typeof buildChecklist>) => steps.flatMap((step) => step.commands ?? []);

describe('buildChecklist', () => {
  it('walks a remote team setup from installation to reservations', () => {
    const profile = remoteProfile();
    const steps = buildChecklist(profile, catalog, generateBenchFiles(profile, catalog));
    expect(ids(steps)).toEqual([
      'install-labgrid',
      'install-tools',
      'device-access',
      'start-coordinator',
      'start-exporter',
      'check-resources',
      'create-place',
      'acquire',
      'share',
      'run-tests',
      'verify',
    ]);
    const all = commands(steps);
    expect(all).toContain('pip install "labgrid[snmp]"');
    expect(all).toContain('sudo apt install ser2net');
    expect(all).toContain('pip install usbsdmux');
    expect(all).toContain('LG_COORDINATOR=coordinator.lab:20408 labgrid-exporter -n labhost exporter.yaml');
    expect(all).toContain('labgrid-client -x coordinator.lab:20408 -p imx8mm-01 create');
    expect(all).toContain('labgrid-client -x coordinator.lab:20408 -p imx8mm-01 add-match labhost/imx8mm-01/*');
    expect(all).toContain('labgrid-client -x coordinator.lab:20408 -p imx8mm-01 console');
    expect(all).toContain('labgrid-client -x coordinator.lab:20408 -p imx8mm-01 power cycle');
    expect(all).toContain('labgrid-client -x coordinator.lab:20408 -p imx8mm-01 set-tags board=i-mx-8m-mini-evk');
    expect(all).toContain('eval "$(labgrid-client -x coordinator.lab:20408 reserve --wait --shell board=i-mx-8m-mini-evk)"');
    expect(all).toContain('pytest --lg-env remote.yaml -v');
    expect(steps.find((step) => step.id === 'start-exporter')?.target).toBe('exporter-host');
    expect(steps.find((step) => step.id === 'create-place')?.target).toBe('client');
    expect(steps.every((step) => step.detail.length > 20)).toBe(true);
  });

  it('skips the coordinator flag and sharing steps for a default solo setup', () => {
    const profile = remoteProfile();
    profile.sharing = 'solo';
    profile.names.coordinator = '127.0.0.1:20408';
    const steps = buildChecklist(profile, catalog, generateBenchFiles(profile, catalog));
    expect(ids(steps)).not.toContain('share');
    expect(commands(steps)).toContain('labgrid-exporter -n labhost exporter.yaml');
    expect(commands(steps)).toContain('labgrid-client -p imx8mm-01 acquire');
    expect(commands(steps).some((command) => command.includes(' -x '))).toBe(false);
  });

  it('names the console in client commands when a class repeats, without add-named-match', () => {
    const profile = remoteProfile();
    profile.devices.push({ id: 'dev-4', kind: 'usb-serial', label: 'Debug UART', match: { ID_SERIAL_SHORT: 'B50285BI' }, speed: 115200 });
    const steps = buildChecklist(profile, catalog, generateBenchFiles(profile, catalog));
    const create = steps.find((step) => step.id === 'create-place');
    expect(create?.commands).toEqual([
      'labgrid-client -x coordinator.lab:20408 -p imx8mm-01 create',
      'labgrid-client -x coordinator.lab:20408 -p imx8mm-01 add-match labhost/imx8mm-01/*',
    ]);
    expect(create?.detail).toContain('come from the keys in exporter.yaml');
    const acquire = steps.find((step) => step.id === 'acquire');
    expect(acquire?.commands).toContain('labgrid-client -x coordinator.lab:20408 -p imx8mm-01 console console');
    expect(acquire?.commands).toContain('labgrid-client -x coordinator.lab:20408 -p imx8mm-01 power cycle');
  });

  it('reserves through --shell so the + place works', () => {
    const profile = remoteProfile();
    const share = buildChecklist(profile, catalog, generateBenchFiles(profile, catalog)).find((step) => step.id === 'share');
    expect(share?.commands).toEqual([
      'labgrid-client -x coordinator.lab:20408 -p imx8mm-01 set-tags board=i-mx-8m-mini-evk',
      'eval "$(labgrid-client -x coordinator.lab:20408 reserve --wait --shell board=i-mx-8m-mini-evk)"',
      'labgrid-client -x coordinator.lab:20408 -p + acquire',
      'labgrid-client -x coordinator.lab:20408 -p + console',
      'labgrid-client -x coordinator.lab:20408 -p + release',
    ]);
    expect(share?.detail).toContain('LG_RESERVATION');
  });

  it('points IMXUSBDriver users at the barebox imx-usb-loader and guards the console snippet', () => {
    const remote = remoteProfile();
    remote.devices.push({ id: 'dev-9', kind: 'imx-usb-loader', label: 'SDP', match: { ID_PATH: 'pci-0000:00:14.0-usb-0:3' } });
    const tools = buildChecklist(remote, catalog, generateBenchFiles(remote, catalog)).find((step) => step.id === 'install-tools');
    expect(tools?.commands?.some((command) => command.includes('barebox'))).toBe(true);
    expect(tools?.commands?.some((command) => command.includes('boundarydevices'))).toBe(false);
    const local: BenchProfile = {
      ...emptyProfile(),
      devices: [{ id: 'dev-1', kind: 'usb-serial', label: 'Console', match: { ID_SERIAL_SHORT: 'A1' }, speed: 115200 }],
    };
    const snippet = buildChecklist(local, catalog, generateBenchFiles(local, catalog)).find((step) => step.id === 'try-environment');
    expect(snippet?.commands?.[0]).toContain('try:');
    expect(snippet?.commands?.[0]).toContain('except Exception');
  });

  it('gives a local user a Python snippet and pytest instead of client commands', () => {
    const profile: BenchProfile = {
      ...emptyProfile(),
      board: { name: 'Nucleo' },
      devices: [
        { id: 'dev-1', kind: 'usb-serial', label: 'Console', match: { ID_PATH: 'pci-0000:00:14.0-usb-0:1:1.0' }, speed: 115200 },
        { id: 'dev-2', kind: 'usb-hub-port', label: 'Hub port', match: { ID_PATH: 'pci-0000:00:14.0-usb-0:2:1.0' }, index: 1 },
        { id: 'dev-3', kind: 'usb-debugger', label: 'ST-Link', match: { ID_PATH: 'pci-0000:00:14.0-usb-0:1:1.0' }, interfaceConfig: 'interface/stlink.cfg' },
      ],
    };
    const steps = buildChecklist(profile, catalog, generateBenchFiles(profile, catalog));
    expect(ids(steps)).toEqual(['install-labgrid', 'install-tools', 'device-access', 'try-environment', 'run-tests', 'verify']);
    const all = commands(steps);
    expect(all).toContain('sudo apt install uhubctl');
    expect(all).toContain('sudo apt install openocd');
    expect(all.some((command) => command.includes("Environment('environment.yaml')") && command.includes('power.cycle()'))).toBe(true);
    expect(all).toContain('pytest --lg-env environment.yaml -v');
    expect(all.some((command) => command.startsWith('labgrid-client'))).toBe(false);
    expect(steps.find((step) => step.id === 'install-tools')?.docs?.some((doc) => doc.url.includes('uhubctl'))).toBe(true);
  });

  it('asks the user to fill placeholders only when files contain them', () => {
    const complete = remoteProfile();
    expect(ids(buildChecklist(complete, catalog, generateBenchFiles(complete, catalog)))).not.toContain('fill-placeholders');
    const incomplete = remoteProfile();
    incomplete.devices[0] = { id: 'dev-1', kind: 'usb-serial', label: 'Console', match: {}, speed: 115200 };
    const steps = buildChecklist(incomplete, catalog, generateBenchFiles(incomplete, catalog));
    const fill = steps.find((step) => step.id === 'fill-placeholders');
    expect(fill?.title).toBe('Replace 1 placeholder value in the generated files');
    expect(fill?.detail).toContain('<ID_SERIAL_SHORT>');
    expect(fill?.commands).toContain('labgrid-suggest');
  });

  it('omits device access when no USB device is present', () => {
    const profile = remoteProfile();
    profile.devices = [{ id: 'dev-1', kind: 'network-pdu', label: 'PDU', model: 'netio', host: 'pdu.lab', index: 1 }];
    const steps = buildChecklist(profile, catalog, generateBenchFiles(profile, catalog));
    expect(ids(steps)).not.toContain('device-access');
    expect(ids(steps)).not.toContain('install-tools');
    expect(commands(steps)).not.toContain('labgrid-client -x coordinator.lab:20408 -p imx8mm-01 console');
  });
});

describe('resource naming helpers', () => {
  it('maps device kinds to Labgrid resource classes', () => {
    expect(resourceClassOf({ id: 'a', kind: 'usb-serial', label: 'c', match: {}, speed: 115200 })).toBe('USBSerialPort');
    expect(resourceClassOf({ id: 'a', kind: 'manual-power', label: 'm' })).toBeUndefined();
    expect(resourceClassOf({ id: 'a', kind: 'unsupported-usb', label: 'u', usbId: { vendorId: '413c', productId: '4503' } })).toBeUndefined();
  });

  it('uses class names when unique and deduplicated slugs otherwise', () => {
    const names = exporterResourceNames([
      { id: 'a', kind: 'usb-serial', label: 'Console', match: {}, speed: 115200 },
      { id: 'b', kind: 'usb-serial', label: 'Console', match: {}, speed: 115200 },
      { id: 'c', kind: 'ykush', label: 'Power', serial: 'Y', index: '1' },
    ]);
    expect(names.get('a')).toBe('console');
    expect(names.get('b')).toBe('console-2');
    expect(names.get('c')).toBe('YKUSHPowerPort');
    const mixedPower = exporterResourceNames([
      { id: 'a', kind: 'usb-serial', label: 'Console', match: {}, speed: 115200 },
      { id: 'b', kind: 'network-pdu', label: 'Outlet', model: 'netio', host: 'pdu', index: 1 },
      { id: 'c', kind: 'ykush', label: 'USB power', serial: 'Y', index: '1' },
    ]);
    expect(mixedPower.get('a')).toBe('USBSerialPort');
    expect(mixedPower.get('b')).toBe('outlet');
    expect(mixedPower.get('c')).toBe('usb-power');
  });
});
