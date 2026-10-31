import { beforeEach, describe, expect, it } from 'vitest';
import { emptyProfile } from '../src/bench/profile';
import {
  STORAGE_KEY,
  clearProfile,
  decodeShareHash,
  encodeShareHash,
  loadProfile,
  saveProfile,
  summarizeProfile,
  validateProfile,
} from '../src/bench/storage';
import type { BenchProfile, HardwareCatalog } from '../src/bench/types';

const catalog: HardwareCatalog = {
  usbDevices: [
    { vendorId: '10c4', productIds: ['ea60'], vendor: 'Silicon Labs', product: 'CP210x', class: 'usb-serial', chip: 'cp210x', serialNumber: 'shared' },
    { vendorId: '0483', productIds: ['374b'], vendor: 'ST', product: 'ST-LINK/V2.1', class: 'usb-debugger-with-serial', chip: 'stlink' },
  ],
  pduModels: [{ model: 'netio', family: 'NETIO', indexBase: 1, hostFormat: 'host', confidence: 'source' }],
  boards: [],
};

function sample(): BenchProfile {
  return {
    ...emptyProfile(),
    board: { name: 'Raspberry Pi 4', presetId: 'raspberry-pi-4' },
    topology: 'remote',
    names: { place: 'board-01', group: 'board-01', exporterHost: 'bench-pc', coordinator: '127.0.0.1:20408', location: '' },
    devices: [
      { id: 'dev-1', label: 'Console', kind: 'usb-serial', usbId: { vendorId: '10c4', productId: 'ea60' }, match: { ID_PATH: 'pci-0000:00:14.0-usb-0:1.3:1.0' }, speed: 115200 },
      { id: 'dev-2', label: 'PDU', kind: 'network-pdu', model: 'netio', host: 'netio1', index: 1 },
      { id: 'dev-3', label: 'Probe', kind: 'usb-debugger', usbId: { vendorId: '0483', productId: '374b' }, match: { '@ID_PATH': 'pci-0000:00:14.0-usb-0:2' } },
    ],
    login: { username: 'root', prompt: 'root@[\\w-]+:[^ ]+ ', loginPrompt: ' login: ' },
  };
}

describe('bench profile validation', () => {
  it('accepts a complete profile and the empty profile', () => {
    expect(validateProfile(sample())).toEqual({ profile: sample(), errors: [] });
    expect(validateProfile(emptyProfile()).errors).toEqual([]);
  });

  it('rejects unknown device kinds, unknown fields, and duplicate ids', () => {
    const unknownKind = { ...sample(), devices: [{ id: 'x', label: 'X', kind: 'teleporter' }] };
    expect(validateProfile(unknownKind).profile).toBeUndefined();
    expect(validateProfile(unknownKind).errors.length).toBeGreaterThan(0);

    const extraField = { ...sample(), devices: [{ id: 'x', label: 'X', kind: 'manual-power', voltage: 5 }] };
    expect(validateProfile(extraField).errors.join(' ')).toMatch(/additional properties/);

    const duplicate = { ...sample(), devices: [{ id: 'x', label: 'A', kind: 'manual-power' }, { id: 'x', label: 'B', kind: 'manual-power' }] };
    expect(validateProfile(duplicate).errors).toEqual(['duplicate device id "x"']);

    expect(validateProfile({ ...sample(), version: 2 }).profile).toBeUndefined();
    expect(validateProfile({ ...sample(), topology: 'cloud' }).profile).toBeUndefined();
    expect(validateProfile(null).profile).toBeUndefined();
    expect(validateProfile('nope').profile).toBeUndefined();
  });

  it('checks device field types', () => {
    const badSpeed = { ...sample(), devices: [{ id: 'a', label: 'A', kind: 'usb-serial', match: {}, speed: 'fast' }] };
    expect(validateProfile(badSpeed).profile).toBeUndefined();
    const badYkushIndex = { ...sample(), devices: [{ id: 'a', label: 'A', kind: 'ykush', serial: 'Y3N1', index: 1 }] };
    expect(validateProfile(badYkushIndex).profile).toBeUndefined();
    const badUsbId = { ...sample(), devices: [{ id: 'a', label: 'A', kind: 'unsupported-usb', usbId: { vendorId: '12345', productId: 'zz' } }] };
    expect(validateProfile(badUsbId).profile).toBeUndefined();
    const badMatchKey = { ...sample(), devices: [{ id: 'a', label: 'A', kind: 'dfu', match: { 'bad key': 'x' } }] };
    expect(validateProfile(badMatchKey).profile).toBeUndefined();
  });
});

describe('bench profile storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips through localStorage', () => {
    expect(loadProfile()).toBeUndefined();
    saveProfile(sample());
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain('board-01');
    expect(loadProfile()).toEqual(sample());
    clearProfile();
    expect(loadProfile()).toBeUndefined();
  });

  it('ignores corrupt or invalid stored data', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadProfile()).toBeUndefined();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1 }));
    expect(loadProfile()).toBeUndefined();
    expect(loadProfile(undefined)).toBeUndefined();
  });
});

describe('bench share links', () => {
  it('round-trips profiles with non-ASCII names', () => {
    const profile = { ...sample(), board: { name: 'Ölçüm kartı 🙂 №1' } };
    const hash = encodeShareHash(profile);
    expect(hash.startsWith('#bench=')).toBe(true);
    expect(hash).toMatch(/^#bench=[A-Za-z0-9_-]+$/);
    expect(decodeShareHash(hash)).toEqual(profile);
    expect(decodeShareHash(hash.slice(1))).toEqual(profile);
    expect(decodeShareHash(`#theme=dark&${hash.slice(1)}&x=1`)).toEqual(profile);
  });

  it('rejects malformed hashes', () => {
    expect(decodeShareHash('')).toBeUndefined();
    expect(decodeShareHash('#bench=')).toBeUndefined();
    expect(decodeShareHash('#bench=!!!')).toBeUndefined();
    expect(decodeShareHash('#bench=bm90IGpzb24')).toBeUndefined();
    expect(decodeShareHash(`#bench=${btoa(JSON.stringify({ version: 1 }))}`)).toBeUndefined();
    expect(decodeShareHash('#other=1')).toBeUndefined();
  });
});

describe('profile summary', () => {
  it('describes the board, devices, and topology', () => {
    expect(summarizeProfile(sample(), catalog)).toBe('Raspberry Pi 4 · CP210x console · NETIO PDU · ST-Link debug probe · remote (board-01)');
    expect(summarizeProfile(emptyProfile(), catalog)).toBe('Unnamed board · local (board-01)');
  });

  it('deduplicates identical devices and skips unsupported ones', () => {
    const profile: BenchProfile = {
      ...emptyProfile(),
      board: { name: 'Board' },
      devices: [
        { id: 'a', label: 'A', kind: 'usb-serial', match: {}, speed: 115200 },
        { id: 'b', label: 'B', kind: 'usb-serial', match: {}, speed: 9600 },
        { id: 'c', label: 'C', kind: 'unsupported-usb', usbId: { vendorId: '413c', productId: '4503' } },
      ],
    };
    expect(summarizeProfile(profile, catalog)).toBe('Board · USB serial console · local (board-01)');
  });
});
