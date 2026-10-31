import type { BenchDevice, BenchProfile, DeviceKind, DeviceRole } from './types';
import { BENCH_PROFILE_VERSION } from './types';

export const DEFAULT_COORDINATOR = '127.0.0.1:20408';

export function emptyProfile(): BenchProfile {
  return {
    version: BENCH_PROFILE_VERSION,
    board: { name: '' },
    topology: 'local',
    sharing: 'solo',
    names: { place: 'board-01', group: 'board-01', exporterHost: '', coordinator: DEFAULT_COORDINATOR, location: '' },
    devices: [],
  };
}

export function deviceRole(device: BenchDevice): DeviceRole {
  switch (device.kind) {
    case 'usb-serial':
    case 'network-serial':
      return 'console';
    case 'network-pdu':
    case 'ykush':
    case 'usb-hub-port':
    case 'manual-power':
      return 'power';
    case 'usb-debugger':
    case 'dfu':
    case 'fastboot':
      return 'debug';
    case 'imx-usb-loader':
      return 'bootstrap';
    case 'usb-sd-mux':
    case 'usb-storage':
      return 'storage';
    case 'network-service':
      return 'network';
    default:
      return 'other';
  }
}

export function devicesWithRole(profile: BenchProfile, role: DeviceRole): BenchDevice[] {
  return profile.devices.filter((device) => deviceRole(device) === role);
}

/** Valid Labgrid place, group, and resource names: start with a letter or digit, then letters, digits, '-', '_' or '.'. */
export const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function slugify(text: string): string {
  const slug = text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'device';
}

export function nextDeviceId(profile: BenchProfile): string {
  let n = profile.devices.length + 1;
  const taken = new Set(profile.devices.map(({ id }) => id));
  while (taken.has(`dev-${n}`)) n += 1;
  return `dev-${n}`;
}

export function hasRequiredMatch(device: BenchDevice): boolean {
  if (!('match' in device)) return true;
  return Object.values(device.match).some((value) => value.trim().length > 0);
}

/** Device kinds a user can add by hand, in menu order. */
export const ADDABLE_KINDS: DeviceKind[] = [
  'usb-serial', 'network-serial', 'network-pdu', 'ykush', 'usb-hub-port', 'manual-power',
  'usb-debugger', 'dfu', 'fastboot', 'usb-sd-mux', 'usb-storage', 'imx-usb-loader', 'network-service',
];

/** A new device of a kind with sensible defaults; the caller assigns the id. */
export function blankDevice(kind: DeviceKind, id: string): BenchDevice {
  switch (kind) {
    case 'usb-serial': return { id, kind, label: 'Console', match: { ID_SERIAL_SHORT: '' }, speed: 115200 };
    case 'network-serial': return { id, kind, label: 'Console', host: '', port: 4000, speed: 115200, protocol: 'rfc2217' };
    case 'network-pdu': return { id, kind, label: 'PDU outlet', model: 'netio', host: '', index: 1 };
    case 'ykush': return { id, kind, label: 'YKUSH port', serial: '', index: '1' };
    case 'usb-hub-port': return { id, kind, label: 'Hub port', match: { ID_PATH: '' }, index: 1 };
    case 'manual-power': return { id, kind, label: 'Manual power' };
    case 'usb-debugger': return { id, kind, label: 'Debug probe', match: { ID_SERIAL_SHORT: '' } };
    case 'dfu': return { id, kind, label: 'DFU bootloader', match: { ID_PATH: '' } };
    case 'fastboot': return { id, kind, label: 'Fastboot', match: { ID_PATH: '' }, usbId: { vendorId: '18d1', productId: '4ee0' } };
    case 'usb-sd-mux': return { id, kind, label: 'USB-SD-Mux', match: { ID_PATH: '' } };
    case 'usb-storage': return { id, kind, label: 'USB storage', match: { ID_PATH: '' } };
    case 'imx-usb-loader': return { id, kind, label: 'Serial download mode', match: { ID_PATH: '' } };
    case 'network-service': return { id, kind, label: 'SSH', address: '', username: 'root', port: 22 };
    default: return { id, kind: 'manual-power', label: 'Manual power' };
  }
}
