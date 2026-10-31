import Ajv, { type ValidateFunction } from 'ajv';
import { parse } from 'yaml';
import usbDevicesSchema from '../../schemas/hardware-usb-devices.schema.json';
import pduModelsSchema from '../../schemas/hardware-pdu-models.schema.json';
import boardsSchema from '../../schemas/hardware-boards.schema.json';
import usbDevicesSource from '../data/hardware/usb-devices.yaml?raw';
import pduModelsSource from '../data/hardware/pdu-models.yaml?raw';
import boardsSource from '../data/hardware/boards.yaml?raw';
import type { BoardPreset, HardwareCatalog, PduModelEntry, UsbDeviceEntry, UsbId } from './types';

export interface HardwareCatalogSources {
  usbDevices: string;
  pduModels: string;
  boards: string;
}

export class HardwareCatalogError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Invalid hardware catalog:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  }
}

const ajv = new Ajv({ allErrors: true });
const validateUsbDevices = ajv.compile(usbDevicesSchema);
const validatePduModels = ajv.compile(pduModelsSchema);
const validateBoards = ajv.compile(boardsSchema);

const HEX4 = /^[0-9a-f]{4}$/;
const MODEL_NAME = /^[a-z0-9_]+$/;
const BOARD_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const OPENOCD_INTERFACE = /^interface\/[a-z0-9_.-]+\.cfg$/;

function parseSource(name: string, source: string, errors: string[]): unknown {
  try {
    return parse(source);
  } catch (error) {
    errors.push(`${name}: ${error instanceof Error ? error.message : 'YAML parsing failed'}`);
    return undefined;
  }
}

function shapeErrors(name: string, validate: ValidateFunction, value: unknown): string[] {
  if (validate(value)) return [];
  return (validate.errors ?? []).map((error) => `${name}${error.instancePath || '/'} ${error.message ?? 'is invalid'}`);
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

function usbDeviceErrors(devices: UsbDeviceEntry[]): string[] {
  const errors: string[] = [];
  const pairs: string[] = [];
  for (const device of devices) {
    const owner = `usb device ${device.vendor} ${device.product}`;
    if (!HEX4.test(device.vendorId)) errors.push(`${owner} has invalid vendorId "${device.vendorId}"`);
    for (const productId of device.productIds) {
      if (!HEX4.test(productId)) errors.push(`${owner} has invalid productId "${productId}"`);
      pairs.push(`${device.vendorId}:${productId}`);
    }
    if (device.openocdInterface !== undefined && !OPENOCD_INTERFACE.test(device.openocdInterface)) {
      errors.push(`${owner} has invalid openocdInterface "${device.openocdInterface}"`);
    }
  }
  for (const duplicate of duplicates(pairs)) errors.push(`duplicate usb id ${duplicate}`);
  return errors;
}

function pduModelErrors(models: PduModelEntry[]): string[] {
  const errors: string[] = [];
  for (const entry of models) {
    if (!MODEL_NAME.test(entry.model)) errors.push(`invalid pdu model name "${entry.model}"`);
    if (entry.indexMax !== undefined && entry.indexMax < entry.indexBase) {
      errors.push(`pdu model "${entry.model}" has indexMax below indexBase`);
    }
  }
  for (const duplicate of duplicates(models.map(({ model }) => model))) errors.push(`duplicate pdu model "${duplicate}"`);
  return errors;
}

function boardErrors(boards: BoardPreset[]): string[] {
  const errors: string[] = [];
  for (const board of boards) {
    if (!BOARD_ID.test(board.id)) errors.push(`invalid board id "${board.id}"`);
  }
  for (const duplicate of duplicates(boards.map(({ id }) => id))) errors.push(`duplicate board id "${duplicate}"`);
  return errors;
}

/**
 * Parse and validate the three hardware catalog YAML sources.
 * Throws HardwareCatalogError listing every structural and semantic problem.
 */
export function loadHardwareCatalog(sources: HardwareCatalogSources): HardwareCatalog {
  const errors: string[] = [];
  const usbValue = parseSource('usb-devices', sources.usbDevices, errors);
  const pduValue = parseSource('pdu-models', sources.pduModels, errors);
  const boardsValue = parseSource('boards', sources.boards, errors);
  if (errors.length) throw new HardwareCatalogError(errors);

  errors.push(...shapeErrors('usb-devices', validateUsbDevices, usbValue));
  errors.push(...shapeErrors('pdu-models', validatePduModels, pduValue));
  errors.push(...shapeErrors('boards', validateBoards, boardsValue));
  if (errors.length) throw new HardwareCatalogError(errors);

  const usbDevices = (usbValue as { devices: UsbDeviceEntry[] }).devices;
  const pduModels = (pduValue as { models: PduModelEntry[] }).models;
  const boards = (boardsValue as { boards: BoardPreset[] }).boards;

  errors.push(...usbDeviceErrors(usbDevices), ...pduModelErrors(pduModels), ...boardErrors(boards));
  if (errors.length) throw new HardwareCatalogError([...new Set(errors)]);

  return { usbDevices, pduModels, boards };
}

/** Schema and id errors for one board entry as it would appear under `boards:` in the catalog. */
export function validateBoardPreset(preset: BoardPreset): string[] {
  const shape = shapeErrors('board', validateBoards, { schemaVersion: 1, boards: [preset] })
    .map((error) => error.replace(/^board\/boards\/0/, 'board'));
  return [...shape, ...boardErrors([preset])];
}

export function findUsbDevice(catalog: HardwareCatalog, id: UsbId): UsbDeviceEntry | undefined {
  const vendorId = id.vendorId.trim().toLowerCase();
  const productId = id.productId.trim().toLowerCase();
  return catalog.usbDevices.find((device) => device.vendorId === vendorId && device.productIds.includes(productId));
}

export function findPduModel(catalog: HardwareCatalog, model: string): PduModelEntry | undefined {
  const wanted = model.trim().toLowerCase();
  return catalog.pduModels.find((entry) => entry.model === wanted);
}

export function findBoard(catalog: HardwareCatalog, id: string): BoardPreset | undefined {
  return catalog.boards.find((board) => board.id === id);
}

function compareBoards(a: BoardPreset, b: BoardPreset): number {
  return a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name);
}

/** Case-insensitive substring search over name, vendor, family, and tags. An empty query returns every board. */
export function searchBoards(catalog: HardwareCatalog, query: string): BoardPreset[] {
  const needle = query.trim().toLowerCase();
  const sorted = [...catalog.boards].sort(compareBoards);
  if (!needle) return sorted;
  return sorted.filter((board) =>
    [board.name, board.vendor, board.family, ...(board.tags ?? [])].some((field) => field.toLowerCase().includes(needle)),
  );
}

/** The catalog bundled with the application. */
export const hardwareCatalog: HardwareCatalog = loadHardwareCatalog({
  usbDevices: usbDevicesSource,
  pduModels: pduModelsSource,
  boards: boardsSource,
});
