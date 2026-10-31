import { findPduModel, findUsbDevice } from './catalog';
import Ajv from 'ajv';
import schema from '../../schemas/bench-profile.schema.json';
import type { BenchDevice, BenchProfile, HardwareCatalog } from './types';

export const STORAGE_KEY = 'labgrid-advisor-bench';
const HASH_KEY = 'bench';

const ajv = new Ajv({ allErrors: true, discriminator: true });
const validateShape = ajv.compile(schema);

function formatError(error: NonNullable<typeof validateShape.errors>[number]): string {
  return `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`;
}

export function validateProfile(value: unknown): { profile?: BenchProfile; errors: string[] } {
  if (!validateShape(value)) {
    return { errors: [...new Set((validateShape.errors ?? []).map(formatError))] };
  }
  const profile = value as unknown as BenchProfile;
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const device of profile.devices) {
    if (seen.has(device.id)) errors.push(`duplicate device id "${device.id}"`);
    seen.add(device.id);
  }
  if (errors.length > 0) return { errors };
  return { profile, errors: [] };
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function saveProfile(profile: BenchProfile, storage: Storage | undefined = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Storage may be full or disabled; the profile stays in memory.
  }
}

export function loadProfile(storage: Storage | undefined = defaultStorage()): BenchProfile | undefined {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    return validateProfile(JSON.parse(raw)).profile;
  } catch {
    return undefined;
  }
}

export function clearProfile(storage: Storage | undefined = defaultStorage()): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text: string): Uint8Array | undefined {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*$/.test(normalized)) return undefined;
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
}

export function encodeShareHash(profile: BenchProfile): string {
  const bytes = new TextEncoder().encode(JSON.stringify(profile));
  return `#${HASH_KEY}=${bytesToBase64Url(bytes)}`;
}

export function decodeShareHash(hash: string): BenchProfile | undefined {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const encoded = params.get(HASH_KEY);
  if (!encoded) return undefined;
  const bytes = base64UrlToBytes(encoded);
  if (!bytes) return undefined;
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return validateProfile(JSON.parse(json)).profile;
  } catch {
    return undefined;
  }
}

const CHIP_NAMES: Record<string, string> = {
  ftdi: 'FTDI',
  cp210x: 'CP210x',
  ch340: 'CH340',
  ch34x: 'CH34x',
  pl2303: 'PL2303',
  stlink: 'ST-Link',
  jlink: 'J-Link',
  daplink: 'DAPLink',
  'cmsis-dap': 'CMSIS-DAP',
};

function chipName(chip: string | undefined): string | undefined {
  if (!chip) return undefined;
  return CHIP_NAMES[chip.toLowerCase()] ?? chip.toUpperCase();
}

function describeDevice(device: BenchDevice, catalog: HardwareCatalog): string | undefined {
  const usbEntry = 'usbId' in device && device.usbId ? findUsbDevice(catalog, device.usbId) : undefined;
  switch (device.kind) {
    case 'usb-serial':
      return `${chipName(usbEntry?.chip) ?? 'USB serial'} console`;
    case 'network-serial':
      return 'network serial console';
    case 'network-pdu':
      return `${findPduModel(catalog, device.model)?.family ?? device.model} PDU`;
    case 'ykush':
      return 'YKUSH power';
    case 'usb-hub-port':
      return 'USB hub power';
    case 'manual-power':
      return 'manual power';
    case 'usb-debugger':
      return `${chipName(usbEntry?.chip) ?? ''} debug probe`.trim();
    case 'dfu':
      return 'DFU';
    case 'fastboot':
      return 'fastboot';
    case 'usb-sd-mux':
      return 'USB-SD-Mux';
    case 'usb-storage':
      return 'USB storage';
    case 'imx-usb-loader':
      return 'i.MX USB loader';
    case 'network-service':
      return 'SSH';
    default:
      return undefined;
  }
}

export function summarizeProfile(profile: BenchProfile, catalog: HardwareCatalog): string {
  const parts: string[] = [profile.board.name.trim() || 'Unnamed board'];
  for (const device of profile.devices) {
    const description = describeDevice(device, catalog);
    if (description && !parts.includes(description)) parts.push(description);
  }
  parts.push(`${profile.topology} (${profile.names.place || 'unnamed place'})`);
  return parts.join(' · ');
}
