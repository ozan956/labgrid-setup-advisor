/**
 * Turn a bench profile into a board preset for the hardware catalog.
 *
 * A bench that has been through the checklist is the only source of
 * lab-verified facts, so the exported entry carries `verification: lab`.
 * Everything the bench does not record (power connector, documentation)
 * falls back to the preset the user picked, or to honest placeholders the
 * contributor is asked to edit.
 */

import { Document, isSeq } from 'yaml';
import { findBoard, findUsbDevice } from './catalog';
import { devicesWithRole } from './profile';
import type { BenchDevice, BenchProfile, BoardPreset, HardwareCatalog, UsbDeviceClass } from './types';

const PROBE_CLASSES: readonly UsbDeviceClass[] = ['usb-debugger', 'usb-debugger-with-serial', 'altera-usb-blaster'];
const CHIP_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const FLASHING_BY_KIND: Partial<Record<BenchDevice['kind'], NonNullable<BoardPreset['flashing']>[number]>> = {
  'usb-sd-mux': 'sd-card',
  'usb-debugger': 'openocd',
  dfu: 'dfu',
  fastboot: 'fastboot',
  'imx-usb-loader': 'imx-usb-loader',
};

export const FALLBACK_BOARD_ID = 'my-board';
export const FALLBACK_BOARD_NAME = 'My board';
export const FALLBACK_VENDOR = 'Unknown vendor';

export interface BoardPresetOptions {
  /** Export date recorded in `sources`; defaults to today. */
  date?: Date;
}

/** Catalog id for a board name: lower-case words joined by '-', starting with a letter. */
export function boardIdFromName(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) return FALLBACK_BOARD_ID;
  return /^[a-z]/.test(slug) ? slug : `board-${slug}`;
}

function describePower(devices: BenchDevice[]): string {
  const parts = devices.map((device) => {
    switch (device.kind) {
      case 'network-pdu': return `a ${device.model} network PDU outlet`;
      case 'ykush': return 'a Yepkit YKUSH port';
      case 'usb-hub-port': return 'a uhubctl-switched USB hub port';
      case 'manual-power': return 'manual switching';
      default: return undefined;
    }
  }).filter((part): part is string => part !== undefined);
  if (parts.length === 0) return 'No power control was part of this bench.';
  return `Switched with ${parts.join(' and ')} in this bench.`;
}

function consoleFacts(profile: BenchProfile, catalog: HardwareCatalog, preset: BoardPreset | undefined): BoardPreset['console'] {
  const [device] = devicesWithRole(profile, 'console');
  if (!device) {
    return { interface: 'none', speed: 115200, note: 'No console was part of this bench; edit this entry if the board has one.' };
  }
  if (device.kind === 'network-serial') {
    return {
      interface: 'uart-header',
      speed: device.speed,
      note: 'The console was reached through a network serial server; the board-side UART connection was not recorded.',
    };
  }
  if (device.kind !== 'usb-serial') {
    return { interface: 'none', speed: 115200 };
  }
  const entry = device.usbId ? findUsbDevice(catalog, device.usbId) : undefined;
  const chip = entry?.chip && CHIP_PATTERN.test(entry.chip) ? entry.chip : undefined;
  if (entry && PROBE_CLASSES.includes(entry.class)) {
    return { interface: 'cdc-acm', speed: device.speed, ...(chip ? { chip } : {}) };
  }
  const fromPreset = preset && preset.console.interface !== 'none' ? preset.console : undefined;
  return {
    interface: fromPreset?.interface ?? 'uart-header',
    speed: device.speed,
    ...(chip ? { chip } : {}),
    ...(fromPreset?.note ? { note: fromPreset.note } : {}),
  };
}

function familyFor(preset: BoardPreset | undefined, name: string, id: string): string {
  if (preset) return preset.family;
  if (!name.trim()) return 'unknown';
  const tokens = id.split('-');
  return id.startsWith('board-') && tokens.length > 1 ? `${tokens[0]}-${tokens[1]}` : tokens[0];
}

/** Derive a lab-verified board preset from a bench profile. Keys follow the catalog schema order. */
export function boardPresetFromProfile(profile: BenchProfile, catalog: HardwareCatalog, options: BoardPresetOptions = {}): BoardPreset {
  const preset = profile.board.presetId ? findBoard(catalog, profile.board.presetId) : undefined;
  const name = profile.board.name.trim() || FALLBACK_BOARD_NAME;
  const id = boardIdFromName(profile.board.name);
  const date = (options.date ?? new Date()).toISOString().slice(0, 10);

  const flashing = [...new Set(
    profile.devices.map((device) => FLASHING_BY_KIND[device.kind]).filter((kind): kind is NonNullable<typeof kind> => kind !== undefined),
  )];
  const powerNote = [preset?.power.note, describePower(devicesWithRole(profile, 'power'))].filter(Boolean).join(' ');

  const result: BoardPreset = {
    id,
    name,
    vendor: preset?.vendor ?? FALLBACK_VENDOR,
    family: familyFor(preset, profile.board.name, id),
    verification: 'lab',
    console: consoleFacts(profile, catalog, preset),
    power: { inputs: preset ? [...preset.power.inputs] : ['other'], note: powerNote },
  };
  if (flashing.length > 0) result.flashing = flashing;
  if (profile.bootloader) result.bootloader = { kind: profile.bootloader.kind, prompt: profile.bootloader.prompt };
  if (preset?.tags && preset.tags.length > 0) result.tags = [...preset.tags];
  if (preset?.docs && preset.docs.length > 0) result.docs = preset.docs.map((doc) => ({ ...doc }));
  // Last, as in the catalog entries.
  result.sources = [`labgrid-setup-advisor bench export ${date}`];
  return result;
}

const FLOW_SEQUENCES: ReadonlyArray<ReadonlyArray<string | number>> = [
  ['boards', 0, 'power', 'inputs'],
  ['boards', 0, 'flashing'],
  ['boards', 0, 'tags'],
];

/**
 * Render one `boards:` list item in the catalog's style, preceded by a comment
 * saying where to paste it. Prepend `boards:` to parse the result on its own.
 */
export function renderBoardPresetYaml(preset: BoardPreset): string {
  const document = new Document({ boards: [preset] }, { aliasDuplicateObjects: false });
  for (const path of FLOW_SEQUENCES) {
    const node = document.getIn(path, true);
    if (isSeq(node)) node.flow = true;
  }
  const body = document.toString({ lineWidth: 0, singleQuote: true, indentSeq: true, flowCollectionPadding: false })
    .replace(/^boards:\n/, '');
  return [
    '# Board preset exported from the Labgrid Setup Advisor bench editor.',
    '# Paste this item under `boards:` in src/data/hardware/boards.yaml, review the',
    '# wording, and run `npm test` to check it against the catalog schema.',
    body,
  ].join('\n');
}
