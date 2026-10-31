/**
 * Bench profile: a description of the user's actual hardware and where it runs.
 *
 * The profile is independent of any single use-case definition. It feeds
 * three consumers: the hardware-aware insight rules, the bench file
 * generator, and the pre-fill mapping into the use-case wizards.
 *
 * Everything here is plain data so it can be stored in localStorage,
 * serialized into a share link, and validated when imported.
 */

export const BENCH_PROFILE_VERSION = 1 as const;

/** Lower-case, four-digit hexadecimal USB identifiers, e.g. { vendorId: '0403', productId: '6001' }. */
export interface UsbId {
  vendorId: string;
  productId: string;
}

/**
 * udev match keys exactly as Labgrid expects them in a `match:` block.
 * Keys starting with `@` are checked against the device's parents.
 * Typical keys: ID_SERIAL_SHORT, ID_USB_INTERFACE_NUM, ID_PATH, '@ID_PATH', '@port_number'.
 */
export type UdevMatch = Record<string, string>;

export type Topology = 'local' | 'remote';
export type Sharing = 'solo' | 'team';

export type DeviceRole = 'console' | 'power' | 'debug' | 'bootstrap' | 'storage' | 'network' | 'other';

interface DeviceBase {
  /** Stable identifier inside the profile, e.g. 'dev-1'. */
  id: string;
  /** Human label shown in the UI and used to derive resource names, e.g. 'Console'. */
  label: string;
  /** Free-form note from detection or the user, e.g. the lsusb description. */
  note?: string;
}

export interface UsbSerialDevice extends DeviceBase {
  kind: 'usb-serial';
  usbId?: UsbId;
  match: UdevMatch;
  /** Baud rate. */
  speed: number;
  /** Device node seen during detection, e.g. '/dev/ttyUSB0'. Informational only. */
  deviceNode?: string;
}

export interface NetworkSerialDevice extends DeviceBase {
  kind: 'network-serial';
  host: string;
  port: number;
  speed: number;
  protocol: 'raw' | 'rfc2217';
}

export interface NetworkPduDevice extends DeviceBase {
  kind: 'network-pdu';
  /** Labgrid backend module name, e.g. 'netio', 'gude8225', 'shelly_gen2'. */
  model: string;
  /** Plain host or URL depending on the backend's hostFormat. */
  host: string;
  index: number;
}

export interface YkushDevice extends DeviceBase {
  kind: 'ykush';
  /** YKUSH serial as printed by `ykushcmd ykush3 -l`, e.g. 'Y3N12345'. */
  serial: string;
  /** Downstream port number as a string ('1'..'3'), or 'a' for all ports. */
  index: string;
}

export interface UsbHubPortDevice extends DeviceBase {
  kind: 'usb-hub-port';
  /** Must match the hub interface, so ID_PATH normally ends with ':1.0'. */
  match: UdevMatch;
  /** Downstream port number as used by uhubctl. */
  index: number;
}

export interface ManualPowerDevice extends DeviceBase {
  kind: 'manual-power';
}

export interface UsbDebuggerDevice extends DeviceBase {
  kind: 'usb-debugger';
  usbId?: UsbId;
  match: UdevMatch;
  /**
   * Labgrid resource class for the probe. USBDebugger only matches the ids in
   * its upstream whitelist (FTDI, ST-LINK, KitProg3, Olimex, J-Link, ADI ICE);
   * Altera/Intel USB-Blasters use AlteraUSBBlaster. Defaults to USBDebugger.
   */
  resourceClass?: 'USBDebugger' | 'AlteraUSBBlaster';
  /** OpenOCD interface script, e.g. 'interface/stlink.cfg'. */
  interfaceConfig?: string;
  /** OpenOCD board script, e.g. 'board/st_nucleo_f4.cfg'. */
  boardConfig?: string;
}

export interface DfuDevice extends DeviceBase {
  kind: 'dfu';
  usbId?: UsbId;
  match: UdevMatch;
}

export interface FastbootDevice extends DeviceBase {
  kind: 'fastboot';
  match: UdevMatch;
  /** Labgrid's AndroidUSBFastboot defaults to 1d6b:0104; real devices differ. */
  usbId: UsbId;
}

export interface UsbSdMuxDevice extends DeviceBase {
  kind: 'usb-sd-mux';
  match: UdevMatch;
}

export interface UsbStorageDevice extends DeviceBase {
  kind: 'usb-storage';
  match: UdevMatch;
}

export interface ImxUsbLoaderDevice extends DeviceBase {
  kind: 'imx-usb-loader';
  usbId?: UsbId;
  match: UdevMatch;
}

export interface NetworkServiceDevice extends DeviceBase {
  kind: 'network-service';
  address: string;
  username: string;
  port: number;
}

/** A USB device the parser recognized but Labgrid has no resource for. Kept so the user sees it was not ignored silently. */
export interface UnsupportedUsbDevice extends DeviceBase {
  kind: 'unsupported-usb';
  usbId: UsbId;
}

export type BenchDevice =
  | UsbSerialDevice
  | NetworkSerialDevice
  | NetworkPduDevice
  | YkushDevice
  | UsbHubPortDevice
  | ManualPowerDevice
  | UsbDebuggerDevice
  | DfuDevice
  | FastbootDevice
  | UsbSdMuxDevice
  | UsbStorageDevice
  | ImxUsbLoaderDevice
  | NetworkServiceDevice
  | UnsupportedUsbDevice;

export type DeviceKind = BenchDevice['kind'];

export interface LinuxLogin {
  username: string;
  /** Regular expression for the shell prompt, e.g. 'root@[\\w-]+:[^ ]+ '. */
  prompt: string;
  /** Text that precedes the login, e.g. ' login: '. */
  loginPrompt: string;
}

export interface Bootloader {
  kind: 'uboot' | 'barebox';
  /** Prompt regular expression, e.g. 'U-Boot> ' or 'barebox@[^:]+:[^ ]+ '. */
  prompt: string;
}

export interface BenchNames {
  /** Coordinator place name, e.g. 'board-01'. */
  place: string;
  /** Exporter group name. Defaults to the place name. */
  group: string;
  /** Hostname of the machine the hardware is plugged into when topology is remote. */
  exporterHost: string;
  /** Coordinator address as HOST[:PORT]. Default '127.0.0.1:20408'. */
  coordinator: string;
  /** Optional physical location label for the exporter group. */
  location: string;
}

export interface BenchProfile {
  version: typeof BENCH_PROFILE_VERSION;
  board: {
    /** Free text, e.g. 'Raspberry Pi 4'. */
    name: string;
    /** Optional id from the board preset catalog. */
    presetId?: string;
  };
  topology: Topology;
  sharing: Sharing;
  names: BenchNames;
  devices: BenchDevice[];
  login?: LinuxLogin;
  bootloader?: Bootloader;
}

/* ------------------------------------------------------------------ */
/* Lab: several benches sharing one exporter host and coordinator      */
/* ------------------------------------------------------------------ */

export const LAB_PROFILE_VERSION = 2 as const;

export interface LabNames {
  /** Hostname of the machine the hardware is plugged into when topology is remote. */
  exporterHost: string;
  /** Coordinator address as HOST[:PORT]. */
  coordinator: string;
  /** Optional physical location label shared by every exporter group. */
  location: string;
}

/** One board with its devices inside a lab. Place and group are per bench; topology and hosts come from the lab. */
export interface LabBench {
  /** Stable id within the lab, e.g. 'bench-1'. Not a Labgrid name. */
  id: string;
  board: BenchProfile['board'];
  /** Coordinator place name, e.g. 'board-01'. */
  place: string;
  /** Exporter group name. Defaults to the place name. */
  group: string;
  devices: BenchDevice[];
  login?: LinuxLogin;
  bootloader?: Bootloader;
}

export interface Lab {
  version: typeof LAB_PROFILE_VERSION;
  /** Free text, e.g. 'Rack 3'. */
  name: string;
  topology: Topology;
  sharing: Sharing;
  names: LabNames;
  benches: LabBench[];
}

/* ------------------------------------------------------------------ */
/* Hardware catalog (loaded from src/data/hardware/*.yaml)             */
/* ------------------------------------------------------------------ */

/** How trustworthy ID_SERIAL_SHORT is for this device family. */
export type SerialNumberQuality = 'unique' | 'usually-unique' | 'shared' | 'none';

/** What a USB id usually is. Mirrors DeviceKind where Labgrid has a resource. */
export type UsbDeviceClass =
  | 'usb-serial'
  | 'usb-debugger'
  | 'usb-debugger-with-serial'
  | 'altera-usb-blaster'
  | 'dfu'
  | 'fastboot'
  | 'ykush'
  | 'usb-hub'
  | 'usb-sd-mux'
  | 'usb-sd-wire'
  | 'imx-usb-loader'
  | 'hid-relay'
  | 'sispm'
  | 'lxa-usb-mux'
  | 'usb-storage'
  | 'root-hub'
  | 'unsupported';

export interface UsbDeviceEntry {
  vendorId: string;
  productIds: string[];
  vendor: string;
  product: string;
  class: UsbDeviceClass;
  /** Converter or probe family, e.g. 'ftdi', 'cp210x', 'ch340', 'pl2303', 'stlink', 'jlink', 'daplink'. */
  chip?: string;
  serialNumber?: SerialNumberQuality;
  /** Suggested OpenOCD interface script when class is a debugger. */
  openocdInterface?: string;
  /** True when a single interface exposes several UARTs so ID_USB_INTERFACE_NUM matters. */
  multiInterface?: boolean;
  notes?: string[];
}

export interface PduModelEntry {
  /** Backend module name used as NetworkPowerPort.model. */
  model: string;
  /** Marketing family shown to the user. */
  family: string;
  /** First outlet index accepted by the backend. */
  indexBase: 0 | 1;
  /** Highest accepted index when the backend enforces one. */
  indexMax?: number;
  /** 'host' for a plain hostname, 'url' when the backend expects http(s)://... */
  hostFormat: 'host' | 'url';
  /** Python extras or system tools the backend needs, e.g. 'pip install labgrid[snmp]', 'snmpset'. */
  requirements?: string[];
  notes?: string[];
  /** 'verified' when a Labgrid maintainer notes tested hardware, 'source' when inferred from code. */
  confidence: 'verified' | 'source';
}

export type BoardVerification = 'unverified' | 'docs' | 'lab';

export interface BoardPreset {
  id: string;
  name: string;
  vendor: string;
  /** Loose family tag: 'raspberry-pi', 'imx', 'zynq', 'stm32', 'beaglebone', 'max32', ... */
  family: string;
  /** 'lab' confirmed on real hardware with Labgrid, 'docs' from vendor documentation or source trees, 'unverified' imported mechanically and not yet reviewed. */
  verification: BoardVerification;
  /** Provenance pointers such as 'u-boot: configs/imx8mm_evk_defconfig'. */
  sources?: string[];
  console: {
    /** 'onboard-usb' when the board carries its own USB-UART, 'uart-header' when an external adapter is needed, 'cdc-acm' for MCU boards with virtual COM ports. */
    interface: 'onboard-usb' | 'uart-header' | 'cdc-acm' | 'none';
    speed: number;
    /** Typical converter chip when known, for the detection hint. */
    chip?: string;
    note?: string;
  };
  power: {
    inputs: Array<'usb-c' | 'micro-usb' | 'barrel' | 'poe' | 'atx' | 'other'>;
    note?: string;
  };
  flashing?: Array<'sd-card' | 'openocd' | 'dfu' | 'fastboot' | 'imx-usb-loader' | 'uuu' | 'jtag-vendor'>;
  bootloader?: { kind: 'uboot' | 'barebox' | 'none'; prompt?: string; note?: string };
  tags?: string[];
  notes?: string[];
  docs?: Array<{ title: string; url: string }>;
}

export interface HardwareCatalog {
  usbDevices: UsbDeviceEntry[];
  pduModels: PduModelEntry[];
  boards: BoardPreset[];
}

/* ------------------------------------------------------------------ */
/* Outputs                                                             */
/* ------------------------------------------------------------------ */

export type InsightSeverity = 'critical' | 'warning' | 'info' | 'success';

export interface Insight {
  id: string;
  severity: InsightSeverity;
  title: string;
  detail: string;
  /** Device ids this insight refers to, for highlighting. */
  devices?: string[];
  docs?: Array<{ title: string; url: string }>;
  /** Optional shell command the user can run to resolve it. */
  command?: string;
}

export interface GeneratedFile {
  /** File name inside the bundle, e.g. 'exporter.yaml'. */
  filename: string;
  /** 'exporter' and 'environment' mirror the use-case template kinds; 'notes' is markdown; 'script' is a shell file. */
  kind: 'exporter' | 'environment' | 'notes' | 'script' | 'service' | 'profile';
  title: string;
  description: string;
  content: string;
  /** Where the file belongs: the machine running labgrid-exporter, or the client machine. */
  target: 'exporter-host' | 'client' | 'coordinator-host';
  /** Placeholder tokens still present in the content, e.g. ['ID_SERIAL_SHORT']. Empty when the file is complete. */
  unresolved: string[];
}

export interface ChecklistStep {
  id: string;
  title: string;
  detail: string;
  /** Where the step is performed. */
  target: 'exporter-host' | 'client' | 'coordinator-host' | 'anywhere';
  commands?: string[];
  docs?: Array<{ title: string; url: string }>;
}

/** Pre-filled answers for one use-case wizard plus placeholder values for its templates. */
export interface Prefill {
  useCaseId: string;
  answers: Record<string, string>;
  values: Record<string, string>;
  /** Short explanation of why this guide is relevant, or undefined when it is not. */
  relevance?: string;
}
