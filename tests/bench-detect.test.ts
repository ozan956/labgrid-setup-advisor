import { describe, expect, it } from 'vitest';
import { suggestDevices } from '../src/bench/detect';
import { parseHardwareText, parseLabgridSuggest, parseLsusb, parseUdevadm } from '../src/bench/parsers';
import type { BenchDevice, HardwareCatalog, UsbSerialDevice } from '../src/bench/types';

const catalog: HardwareCatalog = {
  pduModels: [],
  boards: [],
  usbDevices: [
    { vendorId: '10c4', productIds: ['ea60'], vendor: 'Silicon Labs', product: 'CP210x UART bridge', class: 'usb-serial', chip: 'cp210x', serialNumber: 'shared' },
    { vendorId: '0403', productIds: ['6001'], vendor: 'FTDI', product: 'FT232R', class: 'usb-serial', chip: 'ftdi', serialNumber: 'usually-unique' },
    { vendorId: '0403', productIds: ['6010'], vendor: 'FTDI', product: 'FT2232', class: 'usb-serial', chip: 'ftdi', serialNumber: 'usually-unique', multiInterface: true },
    { vendorId: '0483', productIds: ['374b'], vendor: 'STMicroelectronics', product: 'ST-LINK/V2.1', class: 'usb-debugger-with-serial', chip: 'stlink', serialNumber: 'unique', openocdInterface: 'interface/stlink.cfg' },
    { vendorId: '04d8', productIds: ['f11b'], vendor: 'Yepkit', product: 'YKUSH3', class: 'ykush' },
    { vendorId: '05e3', productIds: ['0608'], vendor: 'Genesys Logic', product: 'USB 2.0 hub', class: 'usb-hub' },
    { vendorId: '1d6b', productIds: ['0002'], vendor: 'Linux Foundation', product: '2.0 root hub', class: 'root-hub' },
    { vendorId: '0424', productIds: ['4041'], vendor: 'Linux Automation', product: 'USB-SD-Mux', class: 'usb-sd-mux' },
    { vendorId: '16c0', productIds: ['05df'], vendor: 'dcttech', product: 'USBRelay2', class: 'hid-relay' },
  ],
};

const LSUSB = `Bus 001 Device 001: ID 1d6b:0002 Linux Foundation 2.0 root hub
Bus 001 Device 002: ID 10c4:ea60 Silicon Labs CP210x UART Bridge
Bus 001 Device 003: ID 0483:374b STMicroelectronics ST-LINK/V2.1
Bus 001 Device 004: ID 413c:4503 Dell Computer Corp. Dell Universal Receiver`;

const UDEVADM_FT2232 = `P: /devices/pci0000:00/0000:00:14.0/usb1/1-3/1-3:1.1/ttyUSB1/tty/ttyUSB1
N: ttyUSB1
E: DEVNAME=/dev/ttyUSB1
E: SUBSYSTEM=tty
E: ID_VENDOR_ID=0403
E: ID_MODEL_ID=6010
E: ID_VENDOR=FTDI
E: ID_MODEL=Dual_RS232-HS
E: ID_SERIAL_SHORT=FT6Z9ABC
E: ID_USB_INTERFACE_NUM=01
E: ID_PATH=pci-0000:00:14.0-usb-0:3:1.1`;

const UDEVADM_CP210X = `P: /devices/pci0000:00/0000:00:14.0/usb1/1-1/1-1:1.0/ttyUSB0/tty/ttyUSB0
N: ttyUSB0
E: SUBSYSTEM=tty
E: ID_VENDOR_ID=10c4
E: ID_MODEL_ID=ea60
E: ID_VENDOR=Silicon_Labs
E: ID_MODEL=CP2102_USB_to_UART_Bridge_Controller
E: ID_SERIAL_SHORT=0001
E: ID_USB_INTERFACE_NUM=00
E: ID_PATH=pci-0000:00:14.0-usb-0:1:1.0`;

const SUGGEST = `=== existing device ===
  USBPowerPort for /devices/pci0000:00/0000:00:14.0/usb1/1-2/1-2:1.0
  === suggested matches ===
  USBPowerPort:
    match:
      ID_PATH: pci-0000:00:14.0-usb-0:2:1.0
    index: ?
  ---

=== added device ===
  USBSerialPort for /devices/pci0000:00/0000:00:14.0/usb1/1-1/1-1:1.0/ttyUSB0/tty/ttyUSB0
  === device properties ===
  device node: /dev/ttyUSB0
  vendor: FTDI
  model: FT232R_USB_UART
  === suggested matches ===
  USBSerialPort:
    match:
      ID_PATH: pci-0000:00:14.0-usb-0:1:1.0
  ---
  USBSerialPort:
    match:
      ID_SERIAL_SHORT: A50285BI
      ID_USB_INTERFACE_NUM: '00'
  ---

=== added device ===
  USBVideo for /devices/pci0000:00/0000:00:14.0/usb1/1-4/1-4:1.0/video4linux/video0
  === no suggested matches found ===
`;

describe('suggestDevices from lsusb', () => {
  const result = suggestDevices({ lsusb: parseLsusb(LSUSB) }, catalog, []);

  it('creates a console for the CP210x and pre-selects ID_PATH because its serial is shared', () => {
    const consoles = result.candidates.filter((candidate) => candidate.device.kind === 'usb-serial');
    const cp210x = consoles.find((candidate) => candidate.catalogEntry?.chip === 'cp210x');
    expect(cp210x).toBeDefined();
    const device = cp210x!.device as UsbSerialDevice;
    expect(device.match).toEqual({ ID_PATH: '' });
    expect(device.speed).toBe(115200);
    expect(device.usbId).toEqual({ vendorId: '10c4', productId: 'ea60' });
    expect(device.note).toBe('Silicon Labs CP210x UART Bridge');
    expect(cp210x!.confidence).toBe('medium');
    expect(cp210x!.explanation).toMatch(/udevadm info/);
    expect(cp210x!.explanation).toMatch(/ID_PATH/);
  });

  it('turns the ST-LINK/V2.1 into a debug probe and a virtual COM port console', () => {
    const stlink = result.candidates.filter((candidate) => candidate.catalogEntry?.chip === 'stlink');
    expect(stlink.map((candidate) => candidate.device.kind).sort()).toEqual(['usb-debugger', 'usb-serial']);
    const probe = stlink.find((candidate) => candidate.device.kind === 'usb-debugger')!.device;
    expect(probe.kind === 'usb-debugger' && probe.interfaceConfig).toBe('interface/stlink.cfg');
    expect(probe.kind === 'usb-debugger' && probe.match).toEqual({ ID_SERIAL_SHORT: '' });
    const serial = stlink.find((candidate) => candidate.device.kind === 'usb-serial')!.device as UsbSerialDevice;
    expect(serial.match).toEqual({ ID_SERIAL_SHORT: '' });
  });

  it('keeps the unknown Dell receiver as unsupported and drops the root hub silently', () => {
    const unsupported = result.candidates.filter((candidate) => candidate.device.kind === 'unsupported-usb');
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0].device.kind === 'unsupported-usb' && unsupported[0].device.usbId).toEqual({ vendorId: '413c', productId: '4503' });
    expect(unsupported[0].confidence).toBe('low');
    expect(result.candidates.some((candidate) => candidate.device.note?.includes('root hub'))).toBe(false);
    expect(result.skipped).toEqual([]);
    expect(result.format).toBe('lsusb');
  });

  it('orders consoles before debug probes and leaves unsupported devices last', () => {
    const kinds = result.candidates.map((candidate) => candidate.device.kind);
    expect(kinds).toEqual(['usb-serial', 'usb-serial', 'usb-debugger', 'unsupported-usb']);
  });

  it('proposes power, SD mux, and skips devices the advisor does not generate', () => {
    const text = `Bus 002 Device 003: ID 04d8:f11b Microchip Technology, Inc. YKUSH3
Bus 002 Device 004: ID 05e3:0608 Genesys Logic, Inc. Hub
Bus 002 Device 005: ID 0424:4041 Microchip Technology, Inc. USB-SD-Mux
Bus 002 Device 006: ID 16c0:05df Van Ooijen Technische Informatica HID device`;
    const detected = suggestDevices({ lsusb: parseLsusb(text) }, catalog, []);
    expect(detected.candidates.map((candidate) => candidate.device.kind)).toEqual(['ykush', 'usb-hub-port', 'usb-sd-mux']);
    const ykush = detected.candidates[0].device;
    expect(ykush.kind === 'ykush' && ykush.serial).toBe('');
    expect(ykush.kind === 'ykush' && ykush.index).toBe('1');
    expect(detected.candidates[0].explanation).toMatch(/ykushcmd ykush3 -l/);
    const hub = detected.candidates[1];
    expect(hub.confidence).toBe('low');
    expect(hub.device.kind === 'usb-hub-port' && hub.device.match).toEqual({ ID_PATH: '' });
    expect(hub.explanation).toMatch(/uhubctl/);
    expect(hub.explanation).toMatch(/:1\.0/);
    expect(detected.candidates[2].device.kind === 'usb-sd-mux' && detected.candidates[2].device.match).toEqual({ '@ID_PATH': '' });
    expect(detected.skipped).toHaveLength(1);
    expect(detected.skipped[0].reason).toMatch(/HIDRelay/);
  });

  it('keeps two identical adapters as separate candidates', () => {
    const text = 'Bus 001 Device 002: ID 0403:6001 FTDI FT232\nBus 001 Device 003: ID 0403:6001 FTDI FT232';
    const detected = suggestDevices({ lsusb: parseLsusb(text) }, catalog, []);
    expect(detected.candidates).toHaveLength(2);
    expect((detected.candidates[0].device as UsbSerialDevice).match).toEqual({ ID_SERIAL_SHORT: '' });
  });
});

describe('suggestDevices from udevadm', () => {
  it('matches a multi-interface FT2232 by serial and interface number', () => {
    const detected = suggestDevices({ udevadm: parseUdevadm(UDEVADM_FT2232) }, catalog, []);
    expect(detected.format).toBe('udevadm');
    expect(detected.candidates).toHaveLength(1);
    const [candidate] = detected.candidates;
    expect(candidate.confidence).toBe('high');
    const device = candidate.device as UsbSerialDevice;
    expect(device.kind).toBe('usb-serial');
    expect(device.match).toEqual({ ID_SERIAL_SHORT: 'FT6Z9ABC', ID_USB_INTERFACE_NUM: '01' });
    expect(device.deviceNode).toBe('/dev/ttyUSB1');
    expect(device.label).toBe('Console (interface 01)');
    expect(device.usbId).toEqual({ vendorId: '0403', productId: '6010' });
  });

  it('matches a CP210x by ID_PATH because its serial 0001 is shared', () => {
    const detected = suggestDevices({ udevadm: parseUdevadm(UDEVADM_CP210X) }, catalog, []);
    const device = detected.candidates[0].device as UsbSerialDevice;
    expect(device.match).toEqual({ ID_PATH: 'pci-0000:00:14.0-usb-0:1:1.0' });
    expect(device.label).toBe('Console');
    expect(detected.candidates[0].explanation).toMatch(/same port/);
  });

  it('builds a hub port match on the hub interface and strips suffixes for the SD mux', () => {
    const text = `P: /devices/pci0000:00/0000:00:14.0/usb1/1-2
E: SUBSYSTEM=usb
E: DEVTYPE=usb_device
E: ID_VENDOR_ID=05e3
E: ID_MODEL_ID=0608
E: ID_PATH=pci-0000:00:14.0-usb-0:2

P: /devices/pci0000:00/0000:00:14.0/usb1/1-2/1-2.3/1-2.3:1.0/host6/target6:0:0/6:0:0:0/block/sdb
N: sdb
E: SUBSYSTEM=block
E: DEVTYPE=disk
E: ID_VENDOR_ID=0424
E: ID_MODEL_ID=4041
E: ID_PATH=pci-0000:00:14.0-usb-0:2.3:1.0-scsi-0:0:0:0`;
    const detected = suggestDevices({ udevadm: parseUdevadm(text) }, catalog, []);
    expect(detected.candidates.map((candidate) => candidate.device.kind)).toEqual(['usb-hub-port', 'usb-sd-mux']);
    expect(detected.candidates[0].device.kind === 'usb-hub-port' && detected.candidates[0].device.match).toEqual({ ID_PATH: 'pci-0000:00:14.0-usb-0:2:1.0' });
    expect(detected.candidates[1].device.kind === 'usb-sd-mux' && detected.candidates[1].device.match).toEqual({ '@ID_PATH': 'pci-0000:00:14.0-usb-0:2.3' });
  });

  it('skips records without usb ids and usb-device records of serial adapters', () => {
    const text = `P: /devices/virtual/tty/tty0
E: SUBSYSTEM=tty

P: /devices/pci0000:00/0000:00:14.0/usb1/1-1
E: SUBSYSTEM=usb
E: DEVTYPE=usb_device
E: ID_VENDOR_ID=10c4
E: ID_MODEL_ID=ea60
E: ID_PATH=pci-0000:00:14.0-usb-0:1`;
    const detected = suggestDevices({ udevadm: parseUdevadm(text) }, catalog, []);
    expect(detected.candidates).toEqual([]);
    expect(detected.skipped).toHaveLength(2);
    expect(detected.skipped[1].reason).toMatch(/tty device/);
  });
});

describe('suggestDevices from labgrid-suggest', () => {
  const detected = suggestDevices({ suggest: parseLabgridSuggest(SUGGEST) }, catalog, []);

  it('prefers the serial-number match for a console and keeps the interface number', () => {
    const console = detected.candidates.find((candidate) => candidate.device.kind === 'usb-serial')!;
    expect(console.confidence).toBe('high');
    const device = console.device as UsbSerialDevice;
    expect(device.match).toEqual({ ID_SERIAL_SHORT: 'A50285BI', ID_USB_INTERFACE_NUM: '00' });
    expect(device.deviceNode).toBe('/dev/ttyUSB0');
    expect(device.note).toBe('FTDI FT232R USB UART');
  });

  it('turns USBPowerPort into a hub port with a default index and a reminder', () => {
    const power = detected.candidates.find((candidate) => candidate.device.kind === 'usb-hub-port')!;
    expect(power.device.kind === 'usb-hub-port' && power.device.match).toEqual({ ID_PATH: 'pci-0000:00:14.0-usb-0:2:1.0' });
    expect(power.device.kind === 'usb-hub-port' && power.device.index).toBe(1);
    expect(power.explanation).toMatch(/index: \?/);
  });

  it('lists resources the advisor does not generate and sorts consoles first', () => {
    expect(detected.format).toBe('labgrid-suggest');
    expect(detected.candidates.map((candidate) => candidate.device.kind)).toEqual(['usb-serial', 'usb-hub-port']);
    expect(detected.skipped).toHaveLength(1);
    expect(detected.skipped[0].summary).toMatch(/USBVideo/);
  });

  it('maps the remaining supported classes and flags fastboot ids', () => {
    const text = `=== added device ===
  USBDebugger for /devices/a
  === suggested matches ===
  USBDebugger:
    match:
      ID_SERIAL_SHORT: 0671FF
  ---
=== added device ===
  AndroidUSBFastboot for /devices/b
  === suggested matches ===
  AndroidUSBFastboot:
    match:
      ID_PATH: pci-0000:00:14.0-usb-0:5
  ---
=== added device ===
  DFUDevice for /devices/c
  === suggested matches ===
  DFUDevice:
    match:
      ID_SERIAL_SHORT: 3570
  ---
=== added device ===
  USBSDMuxDevice for /devices/d
  === suggested matches ===
  USBSDMuxDevice:
    match:
      '@ID_PATH': pci-0000:00:14.0-usb-0:1.2
  ---
=== added device ===
  USBMassStorage for /devices/e
  === suggested matches ===
  USBMassStorage:
    match:
      ID_SERIAL_SHORT: ABC123
  ---
=== added device ===
  IMXUSBLoader for /devices/f
  === suggested matches ===
  IMXUSBLoader:
    match:
      ID_PATH: pci-0000:00:14.0-usb-0:6
  ---
`;
    const result = suggestDevices({ suggest: parseLabgridSuggest(text) }, catalog, []);
    expect(result.candidates.map((candidate) => candidate.device.kind)).toEqual([
      'usb-debugger',
      'fastboot',
      'dfu',
      'usb-sd-mux',
      'usb-storage',
      'imx-usb-loader',
    ]);
    const fastboot = result.candidates.find((candidate) => candidate.device.kind === 'fastboot')!.device;
    expect(fastboot.kind === 'fastboot' && fastboot.usbId).toEqual({ vendorId: '1d6b', productId: '0104' });
    expect(fastboot.note).toMatch(/1d6b:0104/);
    expect(result.skipped).toEqual([]);
  });
});

describe('deduplication and dispatch', () => {
  it('skips candidates that already exist in the profile', () => {
    const existing: BenchDevice[] = [
      { id: 'dev-1', kind: 'usb-serial', label: 'Console', match: { ID_SERIAL_SHORT: 'A50285BI', ID_USB_INTERFACE_NUM: '00' }, speed: 115200 },
    ];
    const detected = suggestDevices({ suggest: parseLabgridSuggest(SUGGEST) }, catalog, existing);
    expect(detected.candidates.map((candidate) => candidate.device.kind)).toEqual(['usb-hub-port']);
  });

  it('does not report the same device twice within one paste', () => {
    const detected = suggestDevices({ udevadm: parseUdevadm(`${UDEVADM_FT2232}\n\n${UDEVADM_FT2232}`) }, catalog, []);
    expect(detected.candidates).toHaveLength(1);
  });

  it('parseHardwareText detects the format and returns nothing for garbage', () => {
    expect(parseHardwareText(LSUSB, catalog, []).format).toBe('lsusb');
    expect(parseHardwareText(UDEVADM_CP210X.replace(/\n/g, '\r\n'), catalog, []).candidates).toHaveLength(1);
    expect(parseHardwareText(SUGGEST, catalog, []).format).toBe('labgrid-suggest');
    const garbage = parseHardwareText('lorem ipsum\n12345', catalog, []);
    expect(garbage).toEqual({ format: 'unknown', candidates: [], skipped: [] });
  });
});
