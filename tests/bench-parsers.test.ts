import { describe, expect, it } from 'vitest';
import { detectInputFormat, parseLabgridSuggest, parseLsusb, parseUdevadm, udev } from '../src/bench/parsers';

const LSUSB = `Bus 001 Device 001: ID 1d6b:0002 Linux Foundation 2.0 root hub
Bus 001 Device 002: ID 10c4:ea60 Silicon Labs CP210x UART Bridge
Bus 001 Device 003: ID 0483:374b STMicroelectronics ST-LINK/V2.1
Bus 001 Device 004: ID 413c:4503 Dell Computer Corp. Dell Universal Receiver`;

const UDEVADM_FT2232 = `P: /devices/pci0000:00/0000:00:14.0/usb1/1-3/1-3:1.1/ttyUSB1/tty/ttyUSB1
N: ttyUSB1
E: DEVNAME=/dev/ttyUSB1
E: DEVPATH=/devices/pci0000:00/0000:00:14.0/usb1/1-3/1-3:1.1/ttyUSB1/tty/ttyUSB1
E: SUBSYSTEM=tty
E: ID_VENDOR_ID=0403
E: ID_MODEL_ID=6010
E: ID_VENDOR=FTDI
E: ID_MODEL=Dual_RS232-HS
E: ID_SERIAL_SHORT=FT6Z9ABC
E: ID_USB_INTERFACE_NUM=01
E: ID_PATH=pci-0000:00:14.0-usb-0:3:1.1
E: ID_PATH_TAG=pci-0000_00_14_0-usb-0_3_1_1`;

const SUGGEST_MANPAGE = `=== added device ===
USBSerialPort for /devices/pci0000:00/0000:00:01.3/0000:02:00.0/usb1/1-3/1-3.1/1-3.1:1.0/ttyUSB0/tty/ttyUSB0
=== device properties ===
device node: /dev/ttyUSB0
udev tags: , systemd
vendor: Silicon_Labs
vendor (DB): Advanced Micro Devices, Inc. [AMD]
model: CP2102_USB_to_UART_Bridge_Controller
revision: 0100
=== suggested matches ===
USBSerialPort:
  match:
    ID_PATH: pci-0000:02:00.0-usb-0:3.1:1.0
---
USBSerialPort:
  match:
    ID_SERIAL_SHORT: P-00-03564
---
`;

const SUGGEST_INDENTED = `=== existing device ===
  USBPowerPort for /devices/pci0000:00/0000:00:14.0/usb1/1-2/1-2:1.0
  === device properties ===
  vendor: Genesys_Logic
  model: USB2.0_Hub
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
  revision: 0600
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

describe('parseLsusb', () => {
  it('extracts bus, device, ids, and description', () => {
    const entries = parseLsusb(LSUSB);
    expect(entries).toHaveLength(4);
    expect(entries[1]).toEqual({
      bus: '001',
      device: '002',
      vendorId: '10c4',
      productId: 'ea60',
      description: 'Silicon Labs CP210x UART Bridge',
    });
  });

  it('lowercases ids and tolerates CRLF, indentation, and verbose dumps', () => {
    const text = '  Bus 002 Device 005: ID 0403:6001 Future Technology Devices International, Ltd FT232 Serial (UART) IC\r\nDevice Descriptor:\r\n  bLength 18\r\n$ lsusb\r\nBus 002 Device 006: ID 04D8:F11B Microchip Technology, Inc. YKUSH3\r\n';
    const entries = parseLsusb(text);
    expect(entries.map((entry) => `${entry.vendorId}:${entry.productId}`)).toEqual(['0403:6001', '04d8:f11b']);
    expect(entries[0].description).toBe('Future Technology Devices International, Ltd FT232 Serial (UART) IC');
  });

  it('returns nothing for unrelated text', () => {
    expect(parseLsusb('hello world\nBus stop')).toEqual([]);
  });
});

describe('parseUdevadm', () => {
  it('reads a single tty device record', () => {
    const [device] = parseUdevadm(UDEVADM_FT2232);
    expect(parseUdevadm(UDEVADM_FT2232)).toHaveLength(1);
    expect(device.devicePath).toBe('/devices/pci0000:00/0000:00:14.0/usb1/1-3/1-3:1.1/ttyUSB1/tty/ttyUSB1');
    expect(device.deviceNode).toBe('/dev/ttyUSB1');
    expect(udev.subsystem(device)).toBe('tty');
    expect(udev.vendorId(device)).toBe('0403');
    expect(udev.modelId(device)).toBe('6010');
    expect(udev.serialShort(device)).toBe('FT6Z9ABC');
    expect(udev.usbInterfaceNum(device)).toBe('01');
    expect(udev.idPath(device)).toBe('pci-0000:00:14.0-usb-0:3:1.1');
  });

  it('derives the node from N: when DEVNAME is missing and splits multiple records', () => {
    const text = 'P: /devices/a/ttyUSB0\r\nN: ttyUSB0\r\nE: SUBSYSTEM=tty\r\nE: ID_VENDOR_ID=10C4\r\n\r\nP: /devices/b\r\nE: SUBSYSTEM=usb\r\nE: ID_VENDOR_ID=1d6b\r\nE: ID_MODEL_ID=0002\r\n';
    const devices = parseUdevadm(text);
    expect(devices).toHaveLength(2);
    expect(devices[0].deviceNode).toBe('/dev/ttyUSB0');
    expect(udev.vendorId(devices[0])).toBe('10c4');
    expect(devices[1].deviceNode).toBeUndefined();
    expect(udev.modelId(devices[1])).toBe('0002');
  });

  it('ignores attribute-walk lines from udevadm info -a', () => {
    const text = 'looking at device \'/devices/x\':\n    KERNEL=="ttyUSB0"\n    ATTRS{idVendor}=="0403"\nE: ID_VENDOR_ID=0403\nE: ID_MODEL_ID=6001';
    const [device] = parseUdevadm(text);
    expect(device.properties).toEqual({ ID_VENDOR_ID: '0403', ID_MODEL_ID: '6001' });
  });
});

describe('parseLabgridSuggest', () => {
  it('parses the man-page style output', () => {
    const entries = parseLabgridSuggest(SUGGEST_MANPAGE);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry.resourceClass).toBe('USBSerialPort');
    expect(entry.devicePath).toContain('/ttyUSB0/tty/ttyUSB0');
    expect(entry.deviceNode).toBe('/dev/ttyUSB0');
    expect(entry.vendor).toBe('Silicon_Labs');
    expect(entry.model).toBe('CP2102_USB_to_UART_Bridge_Controller');
    expect(entry.matches).toEqual([{ ID_PATH: 'pci-0000:02:00.0-usb-0:3.1:1.0' }, { ID_SERIAL_SHORT: 'P-00-03564' }]);
    expect(entry.extraKeys).toEqual({});
  });

  it('parses the indented real output with index hints, quoted numbers, and empty results', () => {
    const entries = parseLabgridSuggest(SUGGEST_INDENTED);
    expect(entries.map((entry) => entry.resourceClass)).toEqual(['USBPowerPort', 'USBSerialPort', 'USBVideo']);
    expect(entries[0].matches).toEqual([{ ID_PATH: 'pci-0000:00:14.0-usb-0:2:1.0' }]);
    expect(entries[0].extraKeys).toEqual({ index: '?' });
    expect(entries[1].matches).toEqual([
      { ID_PATH: 'pci-0000:00:14.0-usb-0:1:1.0' },
      { ID_SERIAL_SHORT: 'A50285BI', ID_USB_INTERFACE_NUM: '00' },
    ]);
    expect(entries[1].deviceNode).toBe('/dev/ttyUSB0');
    expect(entries[2].matches).toEqual([]);
  });

  it('keeps digit-only serials as strings and accepts quoted @ keys', () => {
    const text = `=== added device ===\n  USBSDMuxDevice for /devices/x\n  === suggested matches ===\n  USBSDMuxDevice:\n    match:\n      '@ID_PATH': pci-0000:00:14.0-usb-0:1.2\n  ---\n  USBSDMuxDevice:\n    match:\n      ID_SERIAL_SHORT: 0001\n  ---\n`;
    const [entry] = parseLabgridSuggest(text);
    expect(entry.matches).toEqual([{ '@ID_PATH': 'pci-0000:00:14.0-usb-0:1.2' }, { ID_SERIAL_SHORT: '0001' }]);
  });

  it('handles CRLF line endings', () => {
    const entries = parseLabgridSuggest(SUGGEST_MANPAGE.replace(/\n/g, '\r\n'));
    expect(entries).toHaveLength(1);
    expect(entries[0].matches).toHaveLength(2);
  });
});

describe('detectInputFormat', () => {
  it('recognizes each tool', () => {
    expect(detectInputFormat(LSUSB)).toBe('lsusb');
    expect(detectInputFormat(UDEVADM_FT2232)).toBe('udevadm');
    expect(detectInputFormat(SUGGEST_MANPAGE)).toBe('labgrid-suggest');
    expect(detectInputFormat(SUGGEST_INDENTED)).toBe('labgrid-suggest');
  });

  it('returns unknown for unrelated text', () => {
    expect(detectInputFormat('just some notes\nnothing useful here')).toBe('unknown');
    expect(detectInputFormat('')).toBe('unknown');
  });
});
