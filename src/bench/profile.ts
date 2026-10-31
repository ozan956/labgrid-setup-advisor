import type { BenchDevice, BenchProfile, DeviceRole } from './types';
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
