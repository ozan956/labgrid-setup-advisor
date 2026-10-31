import { describe, expect, it } from 'vitest';
import boardsSource from '../src/data/hardware/boards.yaml?raw';
import pduModelsSource from '../src/data/hardware/pdu-models.yaml?raw';
import usbDevicesSource from '../src/data/hardware/usb-devices.yaml?raw';
import {
  HardwareCatalogError,
  findBoard,
  findPduModel,
  findUsbDevice,
  hardwareCatalog,
  loadHardwareCatalog,
  searchBoards,
} from '../src/bench/catalog';

const sources = { usbDevices: usbDevicesSource, pduModels: pduModelsSource, boards: boardsSource };
// Backend modules in labgrid/driver/power/ at the researched upstream revision.
// Update this list together with pdu-models.yaml when upstream adds a backend.
const upstreamPowerBackends = [
  'apc', 'digipower', 'digitalloggers_http', 'digitalloggers_restapi', 'eaton', 'eg_pms2_network', 'eth008',
  'gude', 'gude24', 'gude8031', 'gude8225', 'gude8316', 'mfi_mpower', 'netio', 'netio_kshell', 'pe6216',
  'poe_mib', 'poe_netgear_plus', 'raritan', 'rest', 'rpm1521', 'sentry', 'shelly_gen1', 'shelly_gen2',
  'siglent', 'simplerest', 'tapo', 'tinycontrol', 'tinycontrol_tcpdu', 'tplink', 'ubus',
];

function errorsOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof HardwareCatalogError) return error.errors;
    throw error;
  }
  throw new Error('expected the catalog to be rejected');
}

describe('hardware catalog', () => {
  it('loads the bundled catalog', () => {
    expect(hardwareCatalog.usbDevices.length).toBeGreaterThanOrEqual(60);
    expect(hardwareCatalog.pduModels.length).toBeGreaterThanOrEqual(30);
    expect(hardwareCatalog.boards.length).toBeGreaterThanOrEqual(15);
    expect(loadHardwareCatalog(sources)).toEqual(hardwareCatalog);
  });

  it('finds usb devices case-insensitively', () => {
    const cp210x = findUsbDevice(hardwareCatalog, { vendorId: '10C4', productId: 'EA60' });
    expect(cp210x?.class).toBe('usb-serial');
    expect(cp210x?.chip).toBe('cp210x');
    expect(cp210x?.serialNumber).toBe('shared');
    expect(findUsbDevice(hardwareCatalog, { vendorId: '0483', productId: '374b' })?.class).toBe('usb-debugger-with-serial');
    expect(findUsbDevice(hardwareCatalog, { vendorId: '04d8', productId: 'f2f7' })?.class).toBe('ykush');
    expect(findUsbDevice(hardwareCatalog, { vendorId: 'ffff', productId: '0000' })).toBeUndefined();
  });

  it('finds pdu models and boards', () => {
    const netio = findPduModel(hardwareCatalog, 'netio');
    expect(netio?.indexBase).toBe(1);
    expect(netio?.hostFormat).toBe('host');
    expect(findPduModel(hardwareCatalog, 'shelly_gen2')?.hostFormat).toBe('url');
    expect(findPduModel(hardwareCatalog, 'digitalloggers_restapi')?.indexBase).toBe(0);
    expect(findBoard(hardwareCatalog, 'raspberry-pi-4')?.console.interface).toBe('uart-header');
    expect(findBoard(hardwareCatalog, 'missing')).toBeUndefined();
  });

  it('searches boards by name, vendor, family, and tags', () => {
    expect(searchBoards(hardwareCatalog, '').length).toBe(hardwareCatalog.boards.length);
    expect(searchBoards(hardwareCatalog, 'ZYNQ').map(({ id }) => id)).toContain('digilent-zedboard');
    expect(searchBoards(hardwareCatalog, 'analog').every((board) => board.vendor === 'Analog Devices')).toBe(true);
    expect(searchBoards(hardwareCatalog, 'cortex-m').map(({ id }) => id)).toContain('stm32-nucleo-64');
    expect(searchBoards(hardwareCatalog, 'no-such-board')).toEqual([]);
    const sorted = searchBoards(hardwareCatalog, '');
    expect(sorted[0].vendor.localeCompare(sorted[sorted.length - 1].vendor)).toBeLessThanOrEqual(0);
  });

  it('matches every pdu model with an upstream backend module', () => {
    expect(hardwareCatalog.pduModels.map(({ model }) => model).sort()).toEqual([...upstreamPowerBackends].sort());
  });

  it('keeps openocd interface scripts well formed', () => {
    const debuggers = hardwareCatalog.usbDevices.filter((device) => device.openocdInterface !== undefined);
    expect(debuggers.length).toBeGreaterThan(0);
    for (const device of debuggers) expect(device.openocdInterface).toMatch(/^interface\/[a-z0-9_.-]+\.cfg$/);
  });

  it('uses only lower-case hex ids without duplicates', () => {
    const pairs = new Set<string>();
    for (const device of hardwareCatalog.usbDevices) {
      expect(device.vendorId).toMatch(/^[0-9a-f]{4}$/);
      for (const productId of device.productIds) {
        expect(productId).toMatch(/^[0-9a-f]{4}$/);
        const pair = `${device.vendorId}:${productId}`;
        expect(pairs.has(pair)).toBe(false);
        pairs.add(pair);
      }
    }
  });

  it('reports duplicate usb ids', () => {
    const usbDevices = `${usbDevicesSource}
  - vendorId: '0403'
    productIds: ['6001']
    vendor: Duplicate
    product: Duplicate FT232R
    class: usb-serial
`;
    expect(errorsOf(() => loadHardwareCatalog({ ...sources, usbDevices }))).toContain('duplicate usb id 0403:6001');
  });

  it('reports malformed hex ids and openocd scripts through the schema', () => {
    const usbDevices = `schemaVersion: 1
devices:
  - vendorId: '04G8'
    productIds: ['ABCD']
    vendor: Bad
    product: Bad ids
    class: usb-debugger
    openocdInterface: stlink.cfg
`;
    const errors = errorsOf(() => loadHardwareCatalog({ ...sources, usbDevices }));
    expect(errors.some((error) => error.includes('/devices/0/vendorId'))).toBe(true);
    expect(errors.some((error) => error.includes('/devices/0/productIds/0'))).toBe(true);
    expect(errors.some((error) => error.includes('/devices/0/openocdInterface'))).toBe(true);
  });

  it('reports bad and duplicate pdu model names', () => {
    const pduModels = `${pduModelsSource}
  - model: netio
    family: Duplicate
    indexBase: 1
    hostFormat: host
    confidence: source
`;
    expect(errorsOf(() => loadHardwareCatalog({ ...sources, pduModels }))).toContain('duplicate pdu model "netio"');
    const badName = `schemaVersion: 1
models:
  - model: Bad-Model
    family: Bad
    indexBase: 1
    hostFormat: host
    confidence: source
`;
    expect(errorsOf(() => loadHardwareCatalog({ ...sources, pduModels: badName })).some((error) => error.includes('/models/0/model'))).toBe(true);
  });

  it('reports duplicate board ids and malformed YAML', () => {
    const boards = `${boardsSource}
  - id: raspberry-pi-4
    name: Duplicate
    vendor: Duplicate
    family: raspberry-pi
    console:
      interface: none
      speed: 115200
    power:
      inputs: [usb-c]
`;
    expect(errorsOf(() => loadHardwareCatalog({ ...sources, boards }))).toContain('duplicate board id "raspberry-pi-4"');
    expect(errorsOf(() => loadHardwareCatalog({ ...sources, boards: 'boards: [' }))[0]).toMatch(/^boards: /);
  });
});
