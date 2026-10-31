import { beforeEach, describe, expect, it } from 'vitest';
import {
  addBench,
  addDevice,
  applyBenchProfile,
  benchOfDevice,
  benchProfile,
  benchProfiles,
  duplicateBench,
  emptyLab,
  labDeviceCount,
  labErrors,
  labFromProfile,
  moveBench,
  moveDevice,
  nextPlaceName,
  removeBench,
  removeDevice,
  updateBench,
  updateLab,
} from '../src/bench/lab';
import { emptyProfile } from '../src/bench/profile';
import {
  LAB_STORAGE_KEY,
  STORAGE_KEY,
  clearLab,
  decodeLabShareHash,
  encodeLabShareHash,
  encodeShareHash,
  hasShareHash,
  loadLab,
  saveLab,
  saveProfile,
  summarizeLab,
  validateLab,
  validateLabOrProfile,
} from '../src/bench/storage';
import type { BenchProfile, HardwareCatalog, Lab } from '../src/bench/types';

const catalog: HardwareCatalog = {
  usbDevices: [
    { vendorId: '10c4', productIds: ['ea60'], vendor: 'Silicon Labs', product: 'CP210x', class: 'usb-serial', chip: 'cp210x', serialNumber: 'shared' },
  ],
  pduModels: [{ model: 'netio', family: 'NETIO', indexBase: 1, hostFormat: 'host', confidence: 'source' }],
  boards: [],
};

function piProfile(): BenchProfile {
  return {
    ...emptyProfile(),
    board: { name: 'Raspberry Pi 4', presetId: 'raspberry-pi-4' },
    topology: 'remote',
    sharing: 'team',
    names: { place: 'board-01', group: 'board-01', exporterHost: 'bench-pc', coordinator: 'coordinator.lab:20408', location: 'Rack 3' },
    devices: [
      { id: 'dev-1', label: 'Console', kind: 'usb-serial', usbId: { vendorId: '10c4', productId: 'ea60' }, match: { ID_PATH: 'pci-0000:00:14.0-usb-0:1.3:1.0' }, speed: 115200 },
      { id: 'dev-2', label: 'PDU', kind: 'network-pdu', model: 'netio', host: 'netio1', index: 1 },
    ],
    login: { username: 'root', prompt: 'root@[\\w-]+:[^ ]+ ', loginPrompt: ' login: ' },
    bootloader: { kind: 'uboot', prompt: 'U-Boot> ' },
  };
}

function twoBenchLab(): Lab {
  const { lab } = addBench(labFromProfile(piProfile()), { name: 'STM32 Nucleo-64', presetId: 'stm32-nucleo-64' });
  return addDevice(lab, 'bench-2', { id: 'dev-1', label: 'ST-LINK', kind: 'usb-serial', match: { ID_SERIAL_SHORT: '0670FF' }, speed: 115200 });
}

describe('lab construction and projection', () => {
  it('wraps a bench profile and projects it back unchanged', () => {
    const profile = piProfile();
    const lab = labFromProfile(profile);
    expect(lab.version).toBe(2);
    expect(lab.benches).toHaveLength(1);
    expect(lab.benches[0].id).toBe('bench-1');
    expect(lab.names).toEqual({ exporterHost: 'bench-pc', coordinator: 'coordinator.lab:20408', location: 'Rack 3' });
    expect(benchProfile(lab, lab.benches[0])).toEqual(profile);
    expect(benchProfiles(lab)).toEqual([profile]);
  });

  it('starts with one empty local bench', () => {
    const lab = emptyLab();
    expect(lab.benches).toHaveLength(1);
    expect(lab.topology).toBe('local');
    expect(benchProfile(lab, lab.benches[0])).toEqual(emptyProfile());
    expect(labErrors(lab)).toEqual([]);
  });

  it('drops optional login and bootloader when the bench has none', () => {
    const lab = emptyLab();
    const profile = benchProfile(lab, lab.benches[0]);
    expect('login' in profile).toBe(false);
    expect('bootloader' in profile).toBe(false);
  });
});

describe('bench operations', () => {
  it('adds a bench with the next free place name', () => {
    const { lab, bench } = addBench(labFromProfile(piProfile()), { name: 'i.MX 8M Mini EVK' });
    expect(bench.id).toBe('bench-2');
    expect(bench.place).toBe('board-02');
    expect(bench.group).toBe('board-02');
    expect(lab.benches).toHaveLength(2);
    expect(nextPlaceName(lab)).toBe('board-03');
  });

  it('skips place names already taken out of order', () => {
    let lab = labFromProfile(piProfile());
    lab = updateBench(lab, 'bench-1', { place: 'board-02', group: 'board-02' });
    expect(nextPlaceName(lab)).toBe('board-01');
  });

  it('duplicates a bench, blanking udev matches and renaming the place', () => {
    const { lab, bench } = duplicateBench(labFromProfile(piProfile()), 'bench-1');
    expect(lab.benches.map(({ id }) => id)).toEqual(['bench-1', 'bench-2']);
    expect(bench.board).toEqual({ name: 'Raspberry Pi 4', presetId: 'raspberry-pi-4' });
    expect(bench.place).toBe('board-02');
    expect(bench.group).toBe('board-02');
    expect(bench.devices).toHaveLength(2);
    const console = bench.devices[0];
    if (console.kind !== 'usb-serial') throw new Error('unexpected kind');
    expect(console.match).toEqual({ ID_PATH: '' });
    expect(console.speed).toBe(115200);
    expect(bench.devices[1]).toEqual({ id: 'dev-2', label: 'PDU', kind: 'network-pdu', model: 'netio', host: 'netio1', index: 1 });
    expect(bench.login).toEqual(piProfile().login);
    // The original is untouched.
    const original = lab.benches[0].devices[0];
    if (original.kind !== 'usb-serial') throw new Error('unexpected kind');
    expect(original.match).toEqual({ ID_PATH: 'pci-0000:00:14.0-usb-0:1.3:1.0' });
  });

  it('keeps at least one bench when the last one is removed', () => {
    const lab = removeBench(labFromProfile(piProfile()), 'bench-1');
    expect(lab.benches).toHaveLength(1);
    expect(lab.benches[0].devices).toEqual([]);
    expect(lab.benches[0].id).toBe('bench-1');
    expect(removeBench(lab, 'missing')).toBe(lab);
  });

  it('removes one of several benches', () => {
    const lab = removeBench(twoBenchLab(), 'bench-1');
    expect(lab.benches.map(({ id }) => id)).toEqual(['bench-2']);
  });

  it('reorders benches', () => {
    const lab = moveBench(twoBenchLab(), 'bench-2', 0);
    expect(lab.benches.map(({ id }) => id)).toEqual(['bench-2', 'bench-1']);
    expect(moveBench(lab, 'bench-2', 0)).toBe(lab);
    expect(moveBench(lab, 'bench-2', 99).benches.map(({ id }) => id)).toEqual(['bench-1', 'bench-2']);
  });

  it('applies an edited bench profile back, updating shared fields', () => {
    const edited: BenchProfile = {
      ...piProfile(),
      topology: 'local',
      names: { ...piProfile().names, place: 'pi-a', group: 'pi-a', exporterHost: 'other-pc' },
      devices: [],
      login: undefined,
    };
    delete edited.login;
    const lab = applyBenchProfile(twoBenchLab(), 'bench-1', edited);
    expect(lab.topology).toBe('local');
    expect(lab.names.exporterHost).toBe('other-pc');
    expect(lab.benches[0]).toMatchObject({ id: 'bench-1', place: 'pi-a', devices: [] });
    expect('login' in lab.benches[0]).toBe(false);
    expect(lab.benches[1].id).toBe('bench-2');
  });

  it('updates lab-level fields without touching benches', () => {
    const lab = updateLab(twoBenchLab(), { name: 'Rack 3', names: { coordinator: 'coord:20408' } as Lab['names'] });
    expect(lab.name).toBe('Rack 3');
    expect(lab.names).toEqual({ exporterHost: 'bench-pc', coordinator: 'coord:20408', location: 'Rack 3' });
    expect(lab.benches).toHaveLength(2);
  });

  it('refuses to grow past the bench limit', () => {
    let lab = emptyLab();
    for (let n = 1; n < 16; n += 1) lab = addBench(lab).lab;
    expect(lab.benches).toHaveLength(16);
    expect(() => addBench(lab)).toThrow(RangeError);
    expect(() => duplicateBench(lab, 'bench-1')).toThrow(RangeError);
  });
});

describe('device operations across benches', () => {
  it('moves a device to another bench and renames it on collision', () => {
    const lab = moveDevice(twoBenchLab(), 'dev-1', 'bench-1', 'bench-2');
    expect(lab.benches[0].devices.map(({ id }) => id)).toEqual(['dev-2']);
    expect(lab.benches[1].devices.map(({ id, label }) => `${id}:${label}`)).toEqual(['dev-1:ST-LINK', 'dev-2:Console']);
    expect(benchOfDevice(lab, 'dev-2')?.id).toBe('bench-1');
    expect(labDeviceCount(lab)).toBe(3);
  });

  it('moves a device to a position inside the same bench', () => {
    const lab = moveDevice(twoBenchLab(), 'dev-2', 'bench-1', 'bench-1', 0);
    expect(lab.benches[0].devices.map(({ id }) => id)).toEqual(['dev-2', 'dev-1']);
  });

  it('ignores moves with unknown benches or devices', () => {
    const lab = twoBenchLab();
    expect(moveDevice(lab, 'dev-9', 'bench-1', 'bench-2')).toBe(lab);
    expect(moveDevice(lab, 'dev-1', 'bench-9', 'bench-2')).toBe(lab);
  });

  it('adds and removes devices on a bench', () => {
    let lab = addDevice(twoBenchLab(), 'bench-2', { id: 'dev-1', label: 'Hub', kind: 'usb-hub-port', match: { ID_PATH: 'x' }, index: 1 }, 0);
    expect(lab.benches[1].devices.map(({ id, label }) => `${id}:${label}`)).toEqual(['dev-2:Hub', 'dev-1:ST-LINK']);
    lab = removeDevice(lab, 'bench-2', 'dev-2');
    expect(lab.benches[1].devices.map(({ id }) => id)).toEqual(['dev-1']);
    expect(() => addDevice(lab, 'bench-9', lab.benches[0].devices[0])).toThrow(RangeError);
  });
});

describe('lab consistency', () => {
  it('reports duplicate places, groups, bench ids and device ids', () => {
    let lab = twoBenchLab();
    lab = updateBench(lab, 'bench-2', { place: 'board-01', group: 'board-01' });
    expect(labErrors(lab)).toEqual(['place "board-01" is used by two benches', 'exporter group "board-01" is used by two benches']);
    const broken: Lab = { ...lab, benches: [lab.benches[0], { ...lab.benches[0], devices: [lab.benches[0].devices[0], lab.benches[0].devices[0]] }] };
    expect(labErrors(broken)).toContain('duplicate bench id "bench-1"');
    expect(labErrors(broken)).toContain('duplicate device id "dev-1" in bench "bench-1"');
  });

  it('treats an empty group as the place name', () => {
    let lab = twoBenchLab();
    lab = updateBench(lab, 'bench-2', { place: 'board-01', group: '' });
    expect(labErrors(lab)).toContain('exporter group "board-01" is used by two benches');
  });
});

describe('lab storage and sharing', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('validates labs and rejects malformed ones', () => {
    expect(validateLab(twoBenchLab()).lab).toEqual(twoBenchLab());
    expect(validateLab({ version: 2 }).errors.length).toBeGreaterThan(0);
    expect(validateLab({ ...twoBenchLab(), benches: [] }).errors[0]).toMatch(/benches/);
    const dup = updateBench(twoBenchLab(), 'bench-2', { place: 'board-01' });
    expect(validateLab(dup).errors).toEqual(['place "board-01" is used by two benches']);
    expect(validateLab({ ...twoBenchLab(), extra: 1 }).errors[0]).toMatch(/additional/);
  });

  it('accepts a v1 bench profile as a one-bench lab', () => {
    expect(validateLabOrProfile(piProfile()).lab).toEqual(labFromProfile(piProfile()));
    expect(validateLabOrProfile({ version: 1 }).errors.length).toBeGreaterThan(0);
    expect(validateLabOrProfile(twoBenchLab()).lab?.benches).toHaveLength(2);
  });

  it('round-trips through localStorage and clears both keys', () => {
    expect(loadLab()).toBeUndefined();
    saveLab(twoBenchLab());
    expect(window.localStorage.getItem(LAB_STORAGE_KEY)).toContain('bench-2');
    expect(loadLab()).toEqual(twoBenchLab());
    clearLab();
    expect(loadLab()).toBeUndefined();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('upgrades a bench saved by an earlier version', () => {
    saveProfile(piProfile());
    expect(loadLab()).toEqual(labFromProfile(piProfile()));
    saveLab(twoBenchLab());
    expect(loadLab()?.benches).toHaveLength(2);
  });

  it('ignores corrupt stored labs', () => {
    window.localStorage.setItem(LAB_STORAGE_KEY, '{not json');
    expect(loadLab()).toBeUndefined();
    window.localStorage.setItem(LAB_STORAGE_KEY, JSON.stringify({ version: 2 }));
    expect(loadLab()).toBeUndefined();
    expect(loadLab(undefined)).toBeUndefined();
  });

  it('encodes and decodes lab share links, including legacy bench links', () => {
    const hash = encodeLabShareHash(twoBenchLab());
    expect(hash.startsWith('#lab=')).toBe(true);
    expect(hash).toMatch(/^#lab=[A-Za-z0-9_-]+$/);
    expect(decodeLabShareHash(hash)).toEqual(twoBenchLab());
    expect(decodeLabShareHash(encodeShareHash(piProfile()))).toEqual(labFromProfile(piProfile()));
    expect(decodeLabShareHash('#lab=!!!')).toBeUndefined();
    expect(decodeLabShareHash('#other=abc')).toBeUndefined();
    expect(hasShareHash('#lab=abc')).toBe(true);
    expect(hasShareHash('#bench=abc')).toBe(true);
    expect(hasShareHash('#theme=dark')).toBe(false);
  });

  it('summarizes a lab', () => {
    expect(summarizeLab(labFromProfile(piProfile()), catalog)).toBe('Raspberry Pi 4 · CP210x console · NETIO PDU · remote (bench-pc)');
    const summary = summarizeLab(updateLab(twoBenchLab(), { name: 'Rack 3' }), catalog);
    expect(summary.startsWith('Rack 3 · Raspberry Pi 4, STM32 Nucleo-64 · ')).toBe(true);
    expect(summarizeLab(emptyLab(), catalog)).toBe('Unnamed board · local');
  });
});
