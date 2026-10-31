import { findPduModel, findUsbDevice } from './catalog';
import Ajv from 'ajv';
import schema from '../../schemas/bench-profile.schema.json';
import labSchema from '../../schemas/lab-profile.schema.json';
import { labErrors, labFromProfile } from './lab';
import type { BenchDevice, BenchProfile, HardwareCatalog, Lab } from './types';

export const STORAGE_KEY = 'labgrid-advisor-bench';
export const LAB_STORAGE_KEY = 'labgrid-advisor-lab';
const HASH_KEY = 'bench';
const LAB_HASH_KEY = 'lab';

const ajv = new Ajv({ allErrors: true, discriminator: true });
const validateShape = ajv.compile(schema);
const validateLabShape = ajv.compile(labSchema);

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

export function validateLab(value: unknown): { lab?: Lab; errors: string[] } {
  if (!validateLabShape(value)) {
    return { errors: [...new Set((validateLabShape.errors ?? []).map(formatError))] };
  }
  const lab = value as unknown as Lab;
  const errors = labErrors(lab);
  if (errors.length > 0) return { errors };
  return { lab, errors: [] };
}

/** Accept a lab (v2) or a single bench profile (v1), which becomes a lab with one bench. */
export function validateLabOrProfile(value: unknown): { lab?: Lab; errors: string[] } {
  if (value && typeof value === 'object' && (value as { version?: unknown }).version === 1) {
    const result = validateProfile(value);
    return result.profile ? { lab: labFromProfile(result.profile), errors: [] } : { errors: result.errors };
  }
  return validateLab(value);
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

export function saveLab(lab: Lab, storage: Storage | undefined = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(LAB_STORAGE_KEY, JSON.stringify(lab));
  } catch {
    // Storage may be full or disabled; the lab stays in memory.
  }
}

/** Load the saved lab, or upgrade a bench saved by an earlier version into a one-bench lab. */
export function loadLab(storage: Storage | undefined = defaultStorage()): Lab | undefined {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(LAB_STORAGE_KEY);
    if (raw) return validateLab(JSON.parse(raw)).lab;
    const legacy = loadProfile(storage);
    return legacy ? labFromProfile(legacy) : undefined;
  } catch {
    return undefined;
  }
}

export function clearLab(storage: Storage | undefined = defaultStorage()): void {
  try {
    storage?.removeItem(LAB_STORAGE_KEY);
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

export function encodeLabShareHash(lab: Lab): string {
  const bytes = new TextEncoder().encode(JSON.stringify(lab));
  return `#${LAB_HASH_KEY}=${bytesToBase64Url(bytes)}`;
}

/** True when a hash carries a lab or a legacy bench share. */
export function hasShareHash(hash: string): boolean {
  return new RegExp(`(^#|[#&])(${LAB_HASH_KEY}|${HASH_KEY})=`).test(hash);
}

/** Decode a '#lab=' share link, or a legacy '#bench=' link as a one-bench lab. */
export function decodeLabShareHash(hash: string): Lab | undefined {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const encoded = params.get(LAB_HASH_KEY);
  if (!encoded) {
    const legacy = decodeShareHash(hash);
    return legacy ? labFromProfile(legacy) : undefined;
  }
  const bytes = base64UrlToBytes(encoded);
  if (!bytes) return undefined;
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return validateLab(JSON.parse(json)).lab;
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

export function summarizeLab(lab: Lab, catalog: HardwareCatalog): string {
  const boards = lab.benches.map((bench) => bench.board.name.trim() || 'Unnamed board');
  const unique = [...new Set(boards)];
  const parts: string[] = [lab.name.trim() || (lab.benches.length === 1 ? boards[0] : `${lab.benches.length} benches`)];
  if (lab.benches.length > 1 || lab.name.trim()) parts.push(unique.slice(0, 3).join(', ') + (unique.length > 3 ? ', …' : ''));
  const kinds = new Set<string>();
  for (const bench of lab.benches) {
    for (const device of bench.devices) {
      const description = describeDevice(device, catalog);
      if (description) kinds.add(description);
    }
  }
  if (kinds.size > 0) parts.push([...kinds].slice(0, 4).join(' · '));
  parts.push(lab.topology === 'remote' ? `remote (${lab.names.exporterHost.trim() || 'exporter host unset'})` : 'local');
  return parts.join(' · ');
}
