import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { findBoard, findUsbDevice, hardwareCatalog, validateBoardPreset } from '../src/bench/catalog';
import {
  FALLBACK_BOARD_ID,
  FALLBACK_BOARD_NAME,
  FALLBACK_VENDOR,
  boardIdFromName,
  boardPresetFromProfile,
  renderBoardPresetYaml,
} from '../src/bench/preset';
import { emptyProfile } from '../src/bench/profile';
import { sampleBenches } from '../src/bench/samples';
import type { BenchProfile, BoardPreset } from '../src/bench/types';

const DATE = new Date('2026-10-31T12:00:00Z');

function sample(id: string): BenchProfile {
  const bench = sampleBenches.find((entry) => entry.id === id);
  if (!bench) throw new Error(`missing sample ${id}`);
  return bench.profile;
}

function roundTrip(preset: BoardPreset): unknown {
  const parsed = parse(`boards:\n${renderBoardPresetYaml(preset)}`) as { boards: unknown[] };
  return parsed.boards[0];
}

describe('board preset export', () => {
  it('derives a cdc-acm console and OpenOCD flashing from the Nucleo bench', () => {
    const preset = boardPresetFromProfile(sample('nucleo-stlink-local'), hardwareCatalog, { date: DATE });
    const picked = findBoard(hardwareCatalog, 'stm32-nucleo-64')!;
    expect(preset.id).toBe('stm32-nucleo-64');
    expect(preset.name).toBe('STM32 Nucleo-64');
    expect(preset.vendor).toBe(picked.vendor);
    expect(preset.family).toBe(picked.family);
    expect(preset.verification).toBe('lab');
    expect(preset.sources).toEqual(['labgrid-setup-advisor bench export 2026-10-31']);
    expect(preset.console).toEqual({ interface: 'cdc-acm', speed: 115200, chip: 'stlink' });
    expect(preset.flashing).toEqual(['openocd']);
    expect(preset.bootloader).toBeUndefined();
    expect(preset.power.inputs).toEqual(picked.power.inputs);
    expect(preset.power.note).toContain('manual switching');
    expect(preset.tags).toEqual(picked.tags);
    expect(preset.docs).toEqual(picked.docs);
  });

  it('keeps the uart-header interface and names the PDU for the Raspberry Pi bench', () => {
    const preset = boardPresetFromProfile(sample('pi4-pdu-remote'), hardwareCatalog, { date: DATE });
    expect(preset.id).toBe('raspberry-pi-4-model-b');
    expect(preset.console.interface).toBe('uart-header');
    expect(preset.console.chip).toBe('cp210x');
    expect(preset.console.note).toBe(findBoard(hardwareCatalog, 'raspberry-pi-4')!.console.note);
    expect(preset.power.inputs).toEqual(['usb-c']);
    expect(preset.power.note).toContain('netio network PDU outlet');
    expect(preset.flashing).toBeUndefined();
    expect(preset.bootloader).toBeUndefined();
  });

  it('records sd-card flashing, the bootloader prompt and the CP2108 chip for the ZCU102 bench', () => {
    const profile = sample('zcu102-hub-local');
    const preset = boardPresetFromProfile(profile, hardwareCatalog, { date: DATE });
    const console = profile.devices[0];
    if (console.kind !== 'usb-serial' || !console.usbId) throw new Error('unexpected sample shape');
    expect(preset.console.chip).toBe(findUsbDevice(hardwareCatalog, console.usbId)!.chip);
    expect(preset.console.interface).toBe('onboard-usb');
    expect(preset.flashing).toEqual(['sd-card']);
    expect(preset.bootloader).toEqual({ kind: 'uboot', prompt: 'ZynqMP> ' });
    expect(preset.power.note).toContain('uhubctl-switched USB hub port');
  });

  it('maps serial download mode to imx-usb-loader and names the YKUSH', () => {
    const preset = boardPresetFromProfile(sample('imx8mm-ykush-remote'), hardwareCatalog, { date: DATE });
    expect(preset.flashing).toEqual(['imx-usb-loader']);
    expect(preset.bootloader).toEqual({ kind: 'uboot', prompt: '=> ' });
    expect(preset.power.note).toContain('Yepkit YKUSH port');
  });

  it('validates against the catalog schema and round-trips through YAML for every sample', () => {
    for (const bench of sampleBenches) {
      const preset = boardPresetFromProfile(bench.profile, hardwareCatalog, { date: DATE });
      expect(validateBoardPreset(preset), bench.id).toEqual([]);
      expect(roundTrip(preset), bench.id).toEqual(JSON.parse(JSON.stringify(preset)));
      const yaml = renderBoardPresetYaml(preset);
      expect(yaml.startsWith('# Board preset exported')).toBe(true);
      expect(yaml).toContain('src/data/hardware/boards.yaml');
      expect(yaml).toMatch(/\n  - id: /);
      expect(yaml).toContain('    verification: lab\n');
    }
  });

  it('writes inputs, flashing and tags as flow sequences like the catalog', () => {
    const yaml = renderBoardPresetYaml(boardPresetFromProfile(sample('nucleo-stlink-local'), hardwareCatalog, { date: DATE }));
    expect(yaml).toMatch(/inputs: \[[^\]\n]+\]/);
    expect(yaml).toContain('flashing: [openocd]');
    expect(yaml).toMatch(/tags: \[[^\]\n]+\]/);
  });

  it('falls back to honest placeholders when the bench names no known board', () => {
    const preset = boardPresetFromProfile({ ...emptyProfile(), devices: [{ id: 'dev-1', kind: 'network-pdu', label: 'PDU', model: 'netio', host: 'pdu', index: 1 }] }, hardwareCatalog, { date: DATE });
    expect(preset.id).toBe(FALLBACK_BOARD_ID);
    expect(preset.name).toBe(FALLBACK_BOARD_NAME);
    expect(preset.vendor).toBe(FALLBACK_VENDOR);
    expect(preset.family).toBe('unknown');
    expect(preset.console).toEqual({ interface: 'none', speed: 115200, note: expect.stringContaining('No console was part of this bench') });
    expect(preset.power).toEqual({ inputs: ['other'], note: 'Switched with a netio network PDU outlet in this bench.' });
    expect(preset.tags).toBeUndefined();
    expect(preset.docs).toBeUndefined();
    expect(validateBoardPreset(preset)).toEqual([]);
  });

  it('derives ids that start with a letter and a family from an unknown board name', () => {
    expect(boardIdFromName('  Orange Pi 5 Plus! ')).toBe('orange-pi-5-plus');
    expect(boardIdFromName('96Boards HiKey')).toBe('board-96boards-hikey');
    expect(boardIdFromName('***')).toBe(FALLBACK_BOARD_ID);
    const profile: BenchProfile = {
      ...emptyProfile(),
      board: { name: '96Boards HiKey' },
      devices: [{ id: 'dev-1', kind: 'network-serial', label: 'Console', host: 'ser2net', port: 4001, speed: 921600, protocol: 'rfc2217' }],
    };
    const preset = boardPresetFromProfile(profile, hardwareCatalog, { date: DATE });
    expect(preset.id).toBe('board-96boards-hikey');
    expect(preset.family).toBe('board-96boards');
    expect(preset.console).toEqual({ interface: 'uart-header', speed: 921600, note: expect.stringContaining('network serial server') });
    expect(validateBoardPreset(preset)).toEqual([]);
  });

  it('reports schema problems for a hand-edited entry', () => {
    const preset = boardPresetFromProfile(sample('pi4-pdu-remote'), hardwareCatalog, { date: DATE });
    const errors = validateBoardPreset({ ...preset, id: 'Bad Id', console: { ...preset.console, speed: 50 } });
    expect(errors.some((error) => error.includes('board/id'))).toBe(true);
    expect(errors.some((error) => error.includes('board/console/speed'))).toBe(true);
    expect(errors).toContain('invalid board id "Bad Id"');
  });
});
