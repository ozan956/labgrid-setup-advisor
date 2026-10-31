import type { LsusbEntry } from './parsers/lsusb';
import type { SuggestEntry } from './parsers/suggest';
import { udev, type UdevadmDevice } from './parsers/udevadm';
import { deviceRole } from './profile';
import type {
  BenchDevice,
  DeviceRole,
  HardwareCatalog,
  UdevMatch,
  UsbDeviceClass,
  UsbDeviceEntry,
  UsbId,
} from './types';

export type InputFormat = 'lsusb' | 'udevadm' | 'labgrid-suggest' | 'unknown';
export type DetectionSource = Exclude<InputFormat, 'unknown'>;

export interface DetectedCandidate {
  /** Fully formed device with `id: 'pending'`; the UI assigns a real id. */
  device: BenchDevice;
  confidence: 'high' | 'medium' | 'low';
  source: DetectionSource;
  /** Plain-language note about what was detected and what the user still has to do. */
  explanation: string;
  catalogEntry?: UsbDeviceEntry;
}

export interface DetectionResult {
  format: InputFormat;
  candidates: DetectedCandidate[];
  /** Devices that were recognized but intentionally not turned into candidates. */
  skipped: Array<{ summary: string; reason: string }>;
}

export interface ParsedHardware {
  lsusb?: LsusbEntry[];
  udevadm?: UdevadmDevice[];
  suggest?: SuggestEntry[];
}

const PENDING = 'pending';
const DEFAULT_SPEED = 115200;
const FASTBOOT_DEFAULT: UsbId = { vendorId: '1d6b', productId: '0104' };

const ROLE_ORDER: DeviceRole[] = ['console', 'power', 'debug', 'storage', 'bootstrap', 'network', 'other'];

/** Labgrid class names for catalog classes the advisor recognizes but does not generate. */
const UNGENERATED_CLASSES: Partial<Record<UsbDeviceClass, string>> = {
  'hid-relay': 'HIDRelay',
  sispm: 'SiSPMPowerPort',
  'lxa-usb-mux': 'LXAUSBMux',
  'usb-sd-wire': 'USBSDWireDevice',
  'usb-storage': 'USBMassStorage',
};

const FILL_MATCH_HINT = 'Run `udevadm info /dev/ttyUSB0` (use the real device node) or `labgrid-suggest` and paste the output to fill in the match values.';

function lookupUsb(catalog: HardwareCatalog, id: UsbId): UsbDeviceEntry | undefined {
  const vendorId = id.vendorId.toLowerCase();
  const productId = id.productId.toLowerCase();
  return catalog.usbDevices.find(
    (entry) => entry.vendorId.toLowerCase() === vendorId && entry.productIds.some((candidate) => candidate.toLowerCase() === productId),
  );
}

function productText(entry: UsbDeviceEntry | undefined, fallback: string): string {
  if (!entry) return fallback;
  return `${entry.vendor} ${entry.product}`.trim();
}

function serialIsTrustworthy(entry: UsbDeviceEntry | undefined): boolean {
  const quality = entry?.serialNumber;
  return quality === undefined || quality === 'unique' || quality === 'usually-unique';
}

function consoleLabel(interfaceNum: string | undefined, multiInterface: boolean | undefined): string {
  if (interfaceNum !== undefined && (multiInterface || interfaceNum !== '00')) return `Console (interface ${interfaceNum})`;
  return 'Console';
}

/** Remove SCSI and interface suffixes so the value applies to the USB device itself. */
function usbDevicePath(idPath: string): string {
  return idPath.replace(/-scsi-.*$/, '').replace(/:\d+\.\d+$/, '');
}

/** Hub ports are matched on the hub interface, so Labgrid needs the `:1.0` suffix. */
function hubInterfacePath(idPath: string): string {
  return /:\d+\.\d+$/.test(idPath) ? idPath : `${idPath}:1.0`;
}

function matchKey(match: UdevMatch | undefined): string | undefined {
  if (!match) return undefined;
  const pairs = Object.entries(match)
    .filter(([, value]) => value.trim() !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  return pairs.length ? JSON.stringify(pairs) : undefined;
}

function deviceKeys(device: BenchDevice): string[] {
  const keys: string[] = [];
  if ('match' in device) {
    const key = matchKey(device.match);
    if (key) keys.push(`match:${key}`);
  }
  if ('usbId' in device && device.usbId && 'deviceNode' in device && device.deviceNode) {
    keys.push(`node:${device.usbId.vendorId}:${device.usbId.productId}:${device.deviceNode}`);
  }
  if (device.kind === 'ykush' && device.serial.trim()) keys.push(`ykush:${device.serial}:${device.index}`);
  return keys;
}

class Collector {
  readonly candidates: DetectedCandidate[] = [];
  readonly skipped: DetectionResult['skipped'] = [];
  private readonly seen = new Set<string>();

  constructor(existing: BenchDevice[]) {
    for (const device of existing) for (const key of deviceKeys(device)) this.seen.add(key);
  }

  add(candidate: DetectedCandidate, extraKey?: string): void {
    const keys = deviceKeys(candidate.device);
    if (extraKey) keys.push(extraKey);
    if (keys.some((key) => this.seen.has(key))) return;
    for (const key of keys) this.seen.add(key);
    this.candidates.push(candidate);
  }

  skip(summary: string, reason: string): void {
    this.skipped.push({ summary, reason });
  }

  result(format: InputFormat): DetectionResult {
    const sorted = [...this.candidates].sort(
      (a, b) => ROLE_ORDER.indexOf(deviceRole(a.device)) - ROLE_ORDER.indexOf(deviceRole(b.device)),
    );
    return { format, candidates: sorted, skipped: this.skipped };
  }
}

/* ------------------------------------------------------------------ */
/* lsusb: only vendor and product ids are known                        */
/* ------------------------------------------------------------------ */

function fromLsusb(entry: LsusbEntry, catalog: HardwareCatalog, out: Collector): void {
  const usbId: UsbId = { vendorId: entry.vendorId, productId: entry.productId };
  const catalogEntry = lookupUsb(catalog, usbId);
  const summary = `${entry.vendorId}:${entry.productId} ${entry.description}`.trim();
  const product = productText(catalogEntry, entry.description || `USB device ${entry.vendorId}:${entry.productId}`);
  const note = entry.description || product;
  const uniqueKey = `lsusb:${entry.bus}:${entry.device}`;
  const source = 'lsusb' as const;

  if (!catalogEntry) {
    out.add(
      {
        device: { id: PENDING, kind: 'unsupported-usb', label: product, note, usbId },
        confidence: 'low',
        source,
        explanation: 'Not a Labgrid-controllable device as far as this advisor knows. Keep it only as a reminder of what is plugged in.',
      },
      uniqueKey,
    );
    return;
  }

  const addSerial = (): void => {
    const trustworthy = serialIsTrustworthy(catalogEntry);
    const match: UdevMatch = trustworthy ? { ID_SERIAL_SHORT: '' } : { ID_PATH: '' };
    const why = trustworthy
      ? `${product} normally reports a unique serial number, so ID_SERIAL_SHORT is the stable way to match it.`
      : `${product} adapters do not report a unique serial number, so match the USB port path (ID_PATH) and keep the adapter in the same port.`;
    out.add(
      {
        device: { id: PENDING, kind: 'usb-serial', label: 'Console', note, usbId, match, speed: DEFAULT_SPEED },
        confidence: 'medium',
        source,
        explanation: `${why} ${FILL_MATCH_HINT}`,
        catalogEntry,
      },
      `${uniqueKey}:serial`,
    );
  };

  const addDebugger = (): void => {
    out.add(
      {
        device: {
          id: PENDING,
          kind: 'usb-debugger',
          label: 'Debug probe',
          note,
          usbId,
          match: { ID_SERIAL_SHORT: '' },
          interfaceConfig: catalogEntry.openocdInterface,
        },
        confidence: 'medium',
        source,
        explanation: `${product} is in Labgrid's USBDebugger list, so OpenOCDDriver can flash and debug through it. ${FILL_MATCH_HINT}`,
        catalogEntry,
      },
      `${uniqueKey}:debugger`,
    );
  };

  switch (catalogEntry.class) {
    case 'root-hub':
      return;
    case 'usb-serial':
      addSerial();
      return;
    case 'usb-debugger':
      addDebugger();
      return;
    case 'usb-debugger-with-serial':
      addDebugger();
      out.add(
        {
          device: {
            id: PENDING,
            kind: 'usb-serial',
            label: 'Console',
            note: `${note} (virtual COM port)`,
            usbId,
            match: { ID_SERIAL_SHORT: '' },
            speed: DEFAULT_SPEED,
          },
          confidence: 'medium',
          source,
          explanation: `${product} also exposes a virtual COM port (usually /dev/ttyACM*) that can serve as the console. ${FILL_MATCH_HINT}`,
          catalogEntry,
        },
        `${uniqueKey}:serial`,
      );
      return;
    case 'ykush':
      out.add(
        {
          device: { id: PENDING, kind: 'ykush', label: 'Power', note, serial: '', index: '1' },
          confidence: 'medium',
          source,
          explanation:
            'Yepkit YKUSH switches power on its downstream ports. Find its serial with `ykushcmd ykush3 -l` (YKUSH3), `ykushcmd -l` (original YKUSH), or `ykushcmd ykushxs -l` (YKUSH XS), and set the port index the board is plugged into.',
          catalogEntry,
        },
        uniqueKey,
      );
      return;
    case 'usb-hub':
      out.add(
        {
          device: { id: PENDING, kind: 'usb-hub-port', label: 'Power', note, match: { ID_PATH: '' }, index: 1 },
          confidence: 'low',
          source,
          explanation:
            `${product} is a USB hub. Most hubs cannot switch port power; verify with \`uhubctl\` that the port really turns off before relying on it. The ID_PATH must point at the hub interface and end with \`:1.0\`.`,
          catalogEntry,
        },
        uniqueKey,
      );
      return;
    case 'usb-sd-mux':
      out.add(
        {
          device: { id: PENDING, kind: 'usb-sd-mux', label: 'SD mux', note, match: { '@ID_PATH': '' } },
          confidence: 'medium',
          source,
          explanation: `${product} lets Labgrid switch an SD card between the host and the board. ${FILL_MATCH_HINT}`,
          catalogEntry,
        },
        uniqueKey,
      );
      return;
    case 'dfu':
      out.add(
        {
          device: { id: PENDING, kind: 'dfu', label: 'DFU bootloader', note, usbId, match: { ID_SERIAL_SHORT: '' } },
          confidence: 'medium',
          source,
          explanation: `${product} is in DFU mode, so DFUDriver can download firmware with dfu-util. ${FILL_MATCH_HINT}`,
          catalogEntry,
        },
        uniqueKey,
      );
      return;
    case 'fastboot':
      out.add(
        {
          device: { id: PENDING, kind: 'fastboot', label: 'Fastboot', note, usbId, match: { ID_SERIAL_SHORT: '' } },
          confidence: 'medium',
          source,
          explanation: `${product} is a fastboot device. ${FILL_MATCH_HINT}`,
          catalogEntry,
        },
        uniqueKey,
      );
      return;
    case 'imx-usb-loader':
      out.add(
        {
          device: { id: PENDING, kind: 'imx-usb-loader', label: 'Bootstrap (SDP)', note, usbId, match: { ID_PATH: '' } },
          confidence: 'medium',
          source,
          explanation: `${product} is an NXP serial download mode device, so IMXUSBDriver or UUUDriver can load a bootloader over USB. ${FILL_MATCH_HINT}`,
          catalogEntry,
        },
        uniqueKey,
      );
      return;
    case 'unsupported':
      out.add(
        {
          device: { id: PENDING, kind: 'unsupported-usb', label: product, note, usbId },
          confidence: 'low',
          source,
          explanation: catalogEntry.notes?.join(' ') || 'Not a Labgrid-controllable device as far as this advisor knows.',
          catalogEntry,
        },
        uniqueKey,
      );
      return;
    default: {
      const className = UNGENERATED_CLASSES[catalogEntry.class] ?? catalogEntry.class;
      out.skip(summary, `Labgrid supports this device (${className}), but this advisor does not generate it yet.`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* udevadm: full property set                                          */
/* ------------------------------------------------------------------ */

function fromUdevadm(device: UdevadmDevice, catalog: HardwareCatalog, out: Collector): void {
  const vendorId = udev.vendorId(device);
  const modelId = udev.modelId(device);
  const summary = udev.devName(device) ?? device.devicePath ?? 'udev record';
  if (!vendorId || !modelId) {
    out.skip(summary, 'No USB vendor and product id in this record, so it cannot be matched to a Labgrid resource.');
    return;
  }
  const usbId: UsbId = { vendorId, productId: modelId };
  const catalogEntry = lookupUsb(catalog, usbId);
  const subsystem = udev.subsystem(device);
  const serial = udev.serialShort(device);
  const interfaceNum = udev.usbInterfaceNum(device);
  const idPath = udev.idPath(device);
  const deviceNode = udev.devName(device);
  const vendorText = [udev.vendor(device), udev.model(device)].filter(Boolean).join(' ').replace(/_/g, ' ');
  const product = productText(catalogEntry, vendorText || `USB device ${vendorId}:${modelId}`);
  const note = vendorText || product;
  const source = 'udevadm' as const;

  const serialMatch = (): UdevMatch | undefined => {
    if (!serial) return undefined;
    const match: UdevMatch = { ID_SERIAL_SHORT: serial };
    if (interfaceNum !== undefined && (catalogEntry?.multiInterface || interfaceNum !== '00')) match.ID_USB_INTERFACE_NUM = interfaceNum;
    return match;
  };
  const pathMatch = (): UdevMatch | undefined => (idPath ? { ID_PATH: idPath } : undefined);
  const bestMatch = (): UdevMatch | undefined => (serialIsTrustworthy(catalogEntry) ? serialMatch() ?? pathMatch() : pathMatch() ?? serialMatch());

  if (subsystem === 'tty') {
    const match = bestMatch();
    if (!match) {
      out.skip(summary, 'The record has neither ID_SERIAL_SHORT nor ID_PATH, so no stable match can be written.');
      return;
    }
    const usesSerial = 'ID_SERIAL_SHORT' in match;
    const why = usesSerial
      ? `Matched by its serial number${match.ID_USB_INTERFACE_NUM ? ` and interface ${match.ID_USB_INTERFACE_NUM}` : ''}, which stays stable across USB ports.`
      : `${product} does not report a unique serial number, so it is matched by its USB port path. Keep it plugged into the same port.`;
    out.add({
      device: {
        id: PENDING,
        kind: 'usb-serial',
        label: consoleLabel(interfaceNum, catalogEntry?.multiInterface),
        note,
        usbId,
        match,
        speed: DEFAULT_SPEED,
        deviceNode,
      },
      confidence: 'high',
      source,
      explanation: `${deviceNode ?? 'Serial port'} is ${product}. ${why}`,
      catalogEntry,
    });
    return;
  }

  if (!catalogEntry) {
    out.add({
      device: { id: PENDING, kind: 'unsupported-usb', label: product, note, usbId },
      confidence: 'low',
      source,
      explanation: 'Not a Labgrid-controllable device as far as this advisor knows.',
    });
    return;
  }

  switch (catalogEntry.class) {
    case 'root-hub':
      return;
    case 'usb-serial':
      out.skip(summary, `${product} is a serial adapter, but this record is for the USB device rather than its tty node. Run \`udevadm info /dev/ttyUSB0\` on the tty device instead.`);
      return;
    case 'usb-debugger':
    case 'usb-debugger-with-serial': {
      const match = serialMatch() ?? pathMatch();
      if (!match) {
        out.skip(summary, 'The record has neither ID_SERIAL_SHORT nor ID_PATH.');
        return;
      }
      out.add({
        device: { id: PENDING, kind: 'usb-debugger', label: 'Debug probe', note, usbId, match, interfaceConfig: catalogEntry.openocdInterface },
        confidence: 'high',
        source,
        explanation: `${product} is in Labgrid's USBDebugger list, so OpenOCDDriver can use it.${catalogEntry.class === 'usb-debugger-with-serial' ? ' Its virtual COM port is a separate tty device; paste its udevadm record to add the console.' : ''}`,
        catalogEntry,
      });
      return;
    }
    case 'ykush':
      out.add({
        device: { id: PENDING, kind: 'ykush', label: 'Power', note, serial: serial ?? '', index: '1' },
        confidence: serial ? 'medium' : 'low',
        source,
        explanation: serial
          ? `Yepkit YKUSH with USB serial ${serial}. Confirm it with \`ykushcmd ykush3 -l\` (or \`ykushcmd -l\` / \`ykushcmd ykushxs -l\`) and set the port index the board uses.`
          : 'Yepkit YKUSH found. Find its serial with `ykushcmd ykush3 -l` and set the port index the board uses.',
        catalogEntry,
      });
      return;
    case 'usb-hub': {
      if (!idPath) {
        out.skip(summary, 'The hub record has no ID_PATH.');
        return;
      }
      const match = { ID_PATH: hubInterfacePath(idPath) };
      out.add({
        device: { id: PENDING, kind: 'usb-hub-port', label: 'Power', note, match, index: 1 },
        confidence: 'low',
        source,
        explanation: `${product} is a USB hub. Verify with \`uhubctl\` that the port really switches power. The match uses the hub interface path (ending in \`:1.0\`); set the index to the port the board is plugged into.`,
        catalogEntry,
      });
      return;
    }
    case 'usb-sd-mux': {
      if (!idPath) {
        out.skip(summary, 'The USB-SD-Mux record has no ID_PATH.');
        return;
      }
      out.add({
        device: { id: PENDING, kind: 'usb-sd-mux', label: 'SD mux', note, match: { '@ID_PATH': usbDevicePath(idPath) } },
        confidence: 'high',
        source,
        explanation: `${product} lets Labgrid switch the SD card between host and board.`,
        catalogEntry,
      });
      return;
    }
    case 'dfu': {
      const match = serialMatch() ?? pathMatch();
      if (!match) {
        out.skip(summary, 'The record has neither ID_SERIAL_SHORT nor ID_PATH.');
        return;
      }
      out.add({
        device: { id: PENDING, kind: 'dfu', label: 'DFU bootloader', note, usbId, match },
        confidence: 'high',
        source,
        explanation: `${product} is in DFU mode, so DFUDriver can download firmware with dfu-util.`,
        catalogEntry,
      });
      return;
    }
    case 'fastboot': {
      const match = serialMatch() ?? pathMatch();
      if (!match) {
        out.skip(summary, 'The record has neither ID_SERIAL_SHORT nor ID_PATH.');
        return;
      }
      out.add({
        device: { id: PENDING, kind: 'fastboot', label: 'Fastboot', note, usbId, match },
        confidence: 'high',
        source,
        explanation: `${product} is a fastboot device.`,
        catalogEntry,
      });
      return;
    }
    case 'imx-usb-loader': {
      const match = pathMatch() ?? serialMatch();
      if (!match) {
        out.skip(summary, 'The record has neither ID_PATH nor ID_SERIAL_SHORT.');
        return;
      }
      out.add({
        device: { id: PENDING, kind: 'imx-usb-loader', label: 'Bootstrap (SDP)', note, usbId, match },
        confidence: 'high',
        source,
        explanation: `${product} is an NXP serial download mode device for IMXUSBDriver or UUUDriver.`,
        catalogEntry,
      });
      return;
    }
    case 'unsupported':
      out.add({
        device: { id: PENDING, kind: 'unsupported-usb', label: product, note, usbId },
        confidence: 'low',
        source,
        explanation: catalogEntry.notes?.join(' ') || 'Not a Labgrid-controllable device as far as this advisor knows.',
        catalogEntry,
      });
      return;
    default: {
      const className = UNGENERATED_CLASSES[catalogEntry.class] ?? catalogEntry.class;
      out.skip(summary, `Labgrid supports this device (${className}), but this advisor does not generate it yet.`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* labgrid-suggest: resource class and ready-made matches              */
/* ------------------------------------------------------------------ */

function pickMatch(matches: UdevMatch[], preferSerial: boolean): UdevMatch | undefined {
  const withSerial = matches.find((match) => 'ID_SERIAL_SHORT' in match || '@ID_SERIAL_SHORT' in match);
  const withPath = matches.find((match) => 'ID_PATH' in match || '@ID_PATH' in match);
  return (preferSerial ? withSerial ?? withPath : withPath ?? withSerial) ?? matches[0];
}

function fromSuggest(entry: SuggestEntry, out: Collector): void {
  const summary = `${entry.resourceClass} ${entry.deviceNode ?? entry.devicePath}`;
  const note = [entry.vendor, entry.model].filter(Boolean).join(' ').replace(/_/g, ' ') || undefined;
  const source = 'labgrid-suggest' as const;
  if (entry.matches.length === 0) {
    out.skip(summary, 'labgrid-suggest found no usable match keys for this device.');
    return;
  }

  switch (entry.resourceClass) {
    case 'USBSerialPort': {
      const match = pickMatch(entry.matches, true)!;
      const usesSerial = 'ID_SERIAL_SHORT' in match || '@ID_SERIAL_SHORT' in match;
      out.add({
        device: {
          id: PENDING,
          kind: 'usb-serial',
          label: consoleLabel(match.ID_USB_INTERFACE_NUM ?? match['@ID_USB_INTERFACE_NUM'], entry.portNumber !== undefined),
          note,
          match,
          speed: DEFAULT_SPEED,
          deviceNode: entry.deviceNode,
        },
        confidence: 'high',
        source,
        explanation: usesSerial
          ? 'labgrid-suggest found a serial number, which stays stable across USB ports.'
          : 'labgrid-suggest only offered a USB port path, so keep the adapter in the same port.',
      });
      return;
    }
    case 'USBPowerPort': {
      const match = pickMatch(entry.matches, false)!;
      const rawIndex = entry.extraKeys.index;
      const index = rawIndex !== undefined && /^\d+$/.test(rawIndex) ? Number(rawIndex) : 1;
      out.add({
        device: { id: PENDING, kind: 'usb-hub-port', label: 'Power', note, match, index },
        confidence: 'high',
        source,
        explanation:
          'labgrid-suggest prints `index: ?` for hub ports: set the index to the downstream port the board is plugged into, and verify with `uhubctl` that the port really switches power.',
      });
      return;
    }
    case 'USBDebugger':
      out.add({
        device: { id: PENDING, kind: 'usb-debugger', label: 'Debug probe', note, match: pickMatch(entry.matches, true)! },
        confidence: 'high',
        source,
        explanation: 'A debug probe from Labgrid\'s USBDebugger list; set the OpenOCD interface and board scripts.',
      });
      return;
    case 'DFUDevice':
      out.add({
        device: { id: PENDING, kind: 'dfu', label: 'DFU bootloader', note, match: pickMatch(entry.matches, true)! },
        confidence: 'high',
        source,
        explanation: 'A device in DFU mode for DFUDriver and dfu-util.',
      });
      return;
    case 'AndroidUSBFastboot':
      out.add({
        device: {
          id: PENDING,
          kind: 'fastboot',
          label: 'Fastboot',
          note: `${note ? `${note}. ` : ''}Vendor and product id must be set; Labgrid's default 1d6b:0104 is almost never right.`,
          match: pickMatch(entry.matches, true)!,
          usbId: FASTBOOT_DEFAULT,
        },
        confidence: 'high',
        source,
        explanation: 'A fastboot device. Set usb_vendor_id and usb_product_id from `lsusb`; labgrid-suggest does not print them.',
      });
      return;
    case 'USBSDMuxDevice':
      out.add({
        device: { id: PENDING, kind: 'usb-sd-mux', label: 'SD mux', note, match: pickMatch(entry.matches, false)! },
        confidence: 'high',
        source,
        explanation: 'A USB-SD-Mux for switching the SD card between host and board.',
      });
      return;
    case 'USBMassStorage':
      out.add({
        device: { id: PENDING, kind: 'usb-storage', label: 'Storage', note, match: pickMatch(entry.matches, true)! },
        confidence: 'high',
        source,
        explanation: 'A USB mass storage device for USBStorageDriver.',
      });
      return;
    case 'IMXUSBLoader':
      out.add({
        device: { id: PENDING, kind: 'imx-usb-loader', label: 'Bootstrap (SDP)', note, match: pickMatch(entry.matches, false)! },
        confidence: 'high',
        source,
        explanation: 'An NXP serial download mode device for IMXUSBDriver or UUUDriver.',
      });
      return;
    default:
      out.skip(summary, `Labgrid supports ${entry.resourceClass}, but this advisor does not generate it yet.`);
  }
}

/* ------------------------------------------------------------------ */

/** Turn parsed tool output into bench device candidates, skipping duplicates of `existing`. */
export function suggestDevices(parsed: ParsedHardware, catalog: HardwareCatalog, existing: BenchDevice[]): DetectionResult {
  const out = new Collector(existing);
  let format: InputFormat = 'unknown';
  if (parsed.suggest?.length) {
    format = 'labgrid-suggest';
    for (const entry of parsed.suggest) fromSuggest(entry, out);
  }
  if (parsed.udevadm?.length) {
    format = format === 'unknown' ? 'udevadm' : format;
    for (const device of parsed.udevadm) fromUdevadm(device, catalog, out);
  }
  if (parsed.lsusb?.length) {
    format = format === 'unknown' ? 'lsusb' : format;
    for (const entry of parsed.lsusb) fromLsusb(entry, catalog, out);
  }
  return out.result(format);
}
