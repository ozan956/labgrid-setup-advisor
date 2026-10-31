/** One device record from `udevadm info` output. */
export interface UdevadmDevice {
  /** Kernel device path from the `P:` line, e.g. /devices/pci0000:00/.../ttyUSB0. */
  devicePath?: string;
  /** Device node, e.g. /dev/ttyUSB0. Derived from E:DEVNAME or the `N:` line. */
  deviceNode?: string;
  /** Every `E: KEY=VALUE` property. */
  properties: Record<string, string>;
}

const PROPERTY_LINE = /^\s*E:\s*([A-Za-z0-9_.:-]+)=(.*)$/;
const PATH_LINE = /^\s*P:\s*(\S+)\s*$/;
const NODE_LINE = /^\s*N:\s*(\S+)\s*$/;

/**
 * Parse `udevadm info <node>` output. Several devices (for example from `udevadm info -e`)
 * are separated by blank lines. Lines that are not `P:`, `N:`, or `E:` records are ignored,
 * which keeps `udevadm info -a` attribute walks from breaking the parse.
 */
export function parseUdevadm(text: string): UdevadmDevice[] {
  const devices: UdevadmDevice[] = [];
  let current: UdevadmDevice | undefined;

  function flush(): void {
    if (!current) return;
    if (current.devicePath || current.deviceNode || Object.keys(current.properties).length > 0) {
      if (!current.deviceNode && current.properties.DEVNAME) current.deviceNode = current.properties.DEVNAME;
      devices.push(current);
    }
    current = undefined;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.trim() === '') {
      flush();
      continue;
    }
    const path = PATH_LINE.exec(line);
    if (path) {
      if (current?.devicePath) flush();
      current ??= { properties: {} };
      current.devicePath = path[1];
      continue;
    }
    const node = NODE_LINE.exec(line);
    if (node) {
      current ??= { properties: {} };
      current.deviceNode = node[1].startsWith('/') ? node[1] : `/dev/${node[1]}`;
      continue;
    }
    const property = PROPERTY_LINE.exec(line);
    if (property) {
      current ??= { properties: {} };
      current.properties[property[1]] = property[2];
    }
  }
  flush();
  return devices;
}

export function looksLikeUdevadm(text: string): boolean {
  return text.split(/\r?\n/).some((line) => PROPERTY_LINE.test(line) || PATH_LINE.test(line));
}

function property(device: UdevadmDevice, key: string): string | undefined {
  const value = device.properties[key];
  return value === undefined || value === '' ? undefined : value;
}

/** Typed accessors for the udev properties the advisor cares about. */
export const udev = {
  devName: (device: UdevadmDevice) => device.deviceNode ?? property(device, 'DEVNAME'),
  subsystem: (device: UdevadmDevice) => property(device, 'SUBSYSTEM'),
  devType: (device: UdevadmDevice) => property(device, 'DEVTYPE'),
  vendorId: (device: UdevadmDevice) => property(device, 'ID_VENDOR_ID')?.toLowerCase(),
  modelId: (device: UdevadmDevice) => property(device, 'ID_MODEL_ID')?.toLowerCase(),
  vendor: (device: UdevadmDevice) => property(device, 'ID_VENDOR'),
  model: (device: UdevadmDevice) => property(device, 'ID_MODEL'),
  serialShort: (device: UdevadmDevice) => property(device, 'ID_SERIAL_SHORT'),
  usbInterfaceNum: (device: UdevadmDevice) => property(device, 'ID_USB_INTERFACE_NUM'),
  idPath: (device: UdevadmDevice) => property(device, 'ID_PATH'),
};
