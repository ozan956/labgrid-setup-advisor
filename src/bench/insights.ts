import { findBoard as findBoardEntry, findPduModel, findUsbDevice } from './catalog';
import { DEFAULT_COORDINATOR, NAME_PATTERN, devicesWithRole, hasRequiredMatch } from './profile';
import type {
  BenchDevice,
  BenchProfile,
  BoardPreset,
  HardwareCatalog,
  Insight,
  InsightSeverity,
  NetworkPduDevice,
  PduModelEntry,
  UsbDebuggerDevice,
  UsbDeviceEntry,
  UsbHubPortDevice,
  UsbId,
  UsbSerialDevice,
} from './types';

const DOCS = {
  configuration: { title: 'Labgrid configuration reference', url: 'https://labgrid.readthedocs.io/en/latest/configuration.html' },
  udev: { title: 'udev matching', url: 'https://labgrid.readthedocs.io/en/latest/configuration.html#udev-matching' },
  usbPowerPort: { title: 'USBPowerPort', url: 'https://labgrid.readthedocs.io/en/latest/configuration.html#usbpowerport' },
  ykush: { title: 'YKUSHPowerPort', url: 'https://labgrid.readthedocs.io/en/latest/configuration.html#ykushpowerport' },
  networkPowerPort: { title: 'NetworkPowerPort', url: 'https://labgrid.readthedocs.io/en/latest/configuration.html#networkpowerport' },
  powerBackends: { title: 'Power backends', url: 'https://github.com/labgrid-project/labgrid/tree/master/labgrid/driver/power' },
  openocd: { title: 'OpenOCDDriver', url: 'https://labgrid.readthedocs.io/en/latest/configuration.html#openocddriver' },
  gettingStarted: { title: 'Getting started', url: 'https://labgrid.readthedocs.io/en/latest/getting_started.html' },
  exporter: { title: 'labgrid-exporter', url: 'https://labgrid.readthedocs.io/en/latest/man/exporter.html' },
  suggest: { title: 'labgrid-suggest', url: 'https://labgrid.readthedocs.io/en/latest/man/suggest.html' },
  reservations: { title: 'Places and reservations', url: 'https://labgrid.readthedocs.io/en/latest/usage.html' },
  uhubctl: { title: 'uhubctl', url: 'https://github.com/mvp/uhubctl' },
  strategies: { title: 'Strategies', url: 'https://labgrid.readthedocs.io/en/latest/configuration.html#strategies' },
};

const SEVERITY_ORDER: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2, success: 3 };

function findUsb(catalog: HardwareCatalog, id: UsbId | undefined): UsbDeviceEntry | undefined {
  return id ? findUsbDevice(catalog, id) : undefined;
}

function findPdu(catalog: HardwareCatalog, model: string): PduModelEntry | undefined {
  return findPduModel(catalog, model);
}

function findBoard(catalog: HardwareCatalog, id: string | undefined): BoardPreset | undefined {
  return id ? findBoardEntry(catalog, id) : undefined;
}

function sameUsbId(a: UsbId | undefined, b: UsbId | undefined): boolean {
  if (!a || !b) return false;
  return a.vendorId.toLowerCase() === b.vendorId.toLowerCase() && a.productId.toLowerCase() === b.productId.toLowerCase();
}

function matchHasKey(match: Record<string, string>, key: string): boolean {
  return Object.keys(match).some((candidate) => candidate === key || candidate === `@${key}`);
}

function isMissingValue(device: BenchDevice): boolean {
  switch (device.kind) {
    case 'ykush':
      return device.serial.trim().length === 0;
    case 'network-pdu':
    case 'network-serial':
      return device.host.trim().length === 0;
    case 'network-service':
      return device.address.trim().length === 0;
    default:
      return !hasRequiredMatch(device);
  }
}

function pluralDevices(devices: BenchDevice[]): string {
  return devices.map((device) => device.label).join(', ');
}

export function analyzeProfile(profile: BenchProfile, catalog: HardwareCatalog): Insight[] {
  const insights: Insight[] = [];
  const consoles = devicesWithRole(profile, 'console');
  const power = devicesWithRole(profile, 'power');
  const board = findBoard(catalog, profile.board.presetId);

  if (!NAME_PATTERN.test(profile.names.place) || !NAME_PATTERN.test(profile.names.group)) {
    insights.push({
      id: 'invalid-name',
      severity: 'critical',
      title: 'Choose a valid place and group name',
      detail:
        'Place and exporter group names must start with a letter or digit and may only contain letters, digits, "-", "_" and ".". Labgrid uses them in resource paths such as exporter/group/USBSerialPort.',
      docs: [DOCS.gettingStarted],
    });
  }

  const missing = profile.devices.filter((device) => device.kind !== 'manual-power' && device.kind !== 'unsupported-usb' && isMissingValue(device));
  for (const device of missing) {
    insights.push({
      id: `missing-match:${device.id}`,
      severity: 'critical',
      title: `Fill in how Labgrid finds "${device.label}"`,
      detail:
        device.kind === 'ykush'
          ? 'The YKUSH serial number is empty. Labgrid needs it to pick the right hub, so the generated file is a template until you add it.'
          : device.kind === 'network-pdu' || device.kind === 'network-serial' || device.kind === 'network-service'
            ? 'The host address is empty. Labgrid cannot reach the device without it, so the generated file is a template until you add it.'
            : 'The udev match is empty. Labgrid finds USB devices by ID_SERIAL_SHORT or ID_PATH; run labgrid-suggest on the computer the device is plugged into and copy one of the suggested match blocks.',
      devices: [device.id],
      command: device.kind === 'ykush' ? 'ykushcmd ykush3 -l' : device.kind === 'network-pdu' || device.kind === 'network-serial' || device.kind === 'network-service' ? undefined : 'labgrid-suggest',
      docs: [DOCS.suggest, DOCS.udev],
    });
  }

  for (const device of profile.devices) {
    if (device.kind !== 'network-pdu') continue;
    insights.push(...pduInsights(device, catalog));
  }

  for (const device of profile.devices) {
    if (device.kind !== 'usb-serial') continue;
    insights.push(...usbSerialInsights(device, catalog));
  }

  for (const device of profile.devices) {
    if (device.kind !== 'usb-debugger') continue;
    insights.push(...debuggerInsights(device, profile, catalog));
  }

  for (const device of profile.devices) {
    if (device.kind !== 'usb-hub-port') continue;
    insights.push(...hubInsights(device, board));
  }

  const ykush = profile.devices.filter((device) => device.kind === 'ykush');
  if (ykush.length > 0) {
    insights.push({
      id: 'ykush-tools',
      severity: 'info',
      title: 'Install ykushcmd and note the YKUSH serial',
      detail:
        'YKUSHPowerDriver calls the ykushcmd tool on the computer the YKUSH is plugged into. List attached hubs with "ykushcmd ykush3 -l" (use "ykushcmd -l" for the original YKUSH or "ykushcmd ykushxs -l" for the XS). The index is the downstream port number "1", "2" or "3", or "a" for all ports.',
      devices: ykush.map(({ id }) => id),
      command: 'ykushcmd ykush3 -l',
      docs: [DOCS.ykush],
    });
  }

  if (consoles.length === 0) {
    insights.push({
      id: 'no-console',
      severity: 'warning',
      title: 'Add a serial console',
      detail:
        'Most Labgrid workflows read boot messages and run commands over a serial console. Add the USB-to-UART adapter or network serial server connected to the board, or the virtual COM port of a debug probe.',
      docs: [DOCS.configuration],
    });
  }

  if (power.length === 0) {
    insights.push({
      id: 'no-power',
      severity: 'info',
      title: 'No power control yet',
      detail:
        'Without a power device Labgrid can only use ManualPowerDriver, which asks you to switch the board by hand. A Yepkit YKUSH, a USB hub supported by uhubctl, or a network PDU lets Labgrid reboot the board on its own.',
      docs: [DOCS.networkPowerPort, DOCS.usbPowerPort, DOCS.ykush],
    });
  }

  const manualPower = power.filter((device) => device.kind === 'manual-power');
  const controlledPower = power.filter((device) => device.kind !== 'manual-power');
  if (manualPower.length > 0 && controlledPower.length > 0) {
    insights.push({
      id: 'redundant-manual-power',
      severity: 'warning',
      title: 'Manual power is ignored next to a real power controller',
      detail: `${pluralDevices(controlledPower)} already provides PowerProtocol. A ManualPowerDriver beside it would make the target ambiguous, so the generated files leave out ${pluralDevices(manualPower)}. Remove the manual entry if you no longer need it.`,
      devices: manualPower.map(({ id }) => id),
      docs: [DOCS.configuration],
    });
  }

  const loginWithoutConsole = (profile.login !== undefined || profile.bootloader !== undefined) && consoles.length === 0;
  if (loginWithoutConsole) {
    insights.push({
      id: 'login-without-console',
      severity: 'warning',
      title: 'Login and bootloader settings need a console',
      detail: 'ShellDriver, UBootDriver and BareboxDriver all talk over the console. Add a serial console device, or remove the login and bootloader details.',
      docs: [DOCS.configuration],
    });
  }

  if (profile.topology === 'remote') {
    if (profile.names.exporterHost.trim().length === 0) {
      insights.push({
        id: 'remote-exporter-name',
        severity: 'warning',
        title: 'Name the exporter host',
        detail:
          'The exporter name is the first part of every resource path, for example exporter-host/board-01/USBSerialPort. labgrid-client add-match needs it, and labgrid-exporter defaults to the hostname of the machine unless you pass -n.',
        docs: [DOCS.exporter],
      });
    }
    insights.push({
      id: 'remote-exporter-tools',
      severity: 'info',
      title: 'Prepare the exporter host',
      detail:
        (consoles.some((device) => device.kind === 'usb-serial')
          ? 'Install ser2net on the exporter host; labgrid-exporter uses it to share USB serial ports. '
          : '') +
        'Add the user running labgrid-exporter to the dialout group (or the group owning /dev/ttyUSB*), and create /var/cache/labgrid for file uploads.',
      docs: [DOCS.exporter, DOCS.gettingStarted],
    });
    const coordinator = profile.names.coordinator.trim();
    if (coordinator.length > 0 && coordinator !== DEFAULT_COORDINATOR) {
      insights.push({
        id: 'remote-coordinator-address',
        severity: 'info',
        title: 'Point exporter and client at your coordinator',
        detail: `Your coordinator is ${coordinator}, not the default 127.0.0.1:20408. Set LG_COORDINATOR=${coordinator} in the environment of labgrid-exporter and labgrid-client, or pass -x ${coordinator} to labgrid-client.`,
        docs: [DOCS.exporter],
      });
    }
  }

  if (profile.sharing === 'team') {
    insights.push({
      id: 'team-sharing',
      severity: 'info',
      title: 'Share the board through a place',
      detail:
        'Every user acquires the place before using it and releases it afterwards, so two people never drive the board at once. Tag the place (labgrid-client -p PLACE set-tags board=NAME) and let people or CI jobs run labgrid-client reserve to wait for a free board.',
      docs: [DOCS.reservations],
    });
  }

  if (board) {
    if (board.verification === 'unverified') {
      insights.push({
        id: 'board-unverified',
        severity: 'warning',
        title: `${board.name}: preset not yet reviewed`,
        detail: `The facts for this board were imported from source trees (${(board.sources ?? []).join(', ') || 'no sources recorded'}) and nobody has confirmed them on hardware or against the vendor documentation. Check the console speed${board.bootloader?.prompt ? ` and the bootloader prompt "${board.bootloader.prompt}"` : ''} before relying on the generated files, and use "Contribute this board" below once the bench works.`,
        docs: board.docs,
      });
    }
    if (board.console.note) {
      insights.push({
        id: 'board-console-hint',
        severity: 'info',
        title: `${board.name}: console`,
        detail: board.console.note,
        docs: board.docs,
      });
    }
    if (board.power.note) {
      insights.push({
        id: 'board-power-hint',
        severity: 'info',
        title: `${board.name}: power`,
        detail: board.power.note,
        docs: board.docs,
      });
    }
    if (board.bootloader?.prompt && !profile.bootloader) {
      insights.push({
        id: 'board-bootloader-hint',
        severity: 'info',
        title: `${board.name}: bootloader`,
        detail: `This board typically runs ${board.bootloader.kind === 'uboot' ? 'U-Boot' : 'barebox'} with the prompt "${board.bootloader.prompt}". Add it under bootloader to generate a ${board.bootloader.kind === 'uboot' ? 'UBootDriver' : 'BareboxDriver'} and strategy.${board.bootloader.note ? ` ${board.bootloader.note}` : ''}`,
        docs: [DOCS.strategies],
      });
    }
  }

  const unsupported = profile.devices.filter((device) => device.kind === 'unsupported-usb');
  if (unsupported.length > 0) {
    insights.push({
      id: 'unsupported-devices',
      severity: 'info',
      title: 'Devices Labgrid will not control',
      detail: `${pluralDevices(unsupported)}: Labgrid has no resource for ${unsupported.length === 1 ? 'this device' : 'these devices'}, so they are left out of the generated files.`,
      devices: unsupported.map(({ id }) => id),
    });
  }

  if (power.length > 0 && consoles.length > 0 && profile.login) {
    insights.push({
      id: 'strategy-ready',
      severity: 'success',
      title: 'A boot strategy will be generated',
      detail: profile.bootloader
        ? `Power, console, login and bootloader are known, so the environment gets a ${profile.bootloader.kind === 'uboot' ? 'UBootStrategy' : 'BareboxStrategy'}. Tests can ask for the "shell" state and Labgrid boots the board for them.`
        : 'Power, console and login are known, so the environment gets a ShellStrategy. Tests can ask for the "shell" state and Labgrid power-cycles the board and logs in for them.',
      docs: [DOCS.strategies],
    });
  }

  const hasCritical = insights.some((insight) => insight.severity === 'critical');
  if (!hasCritical && !loginWithoutConsole && (consoles.length > 0 || power.length > 0)) {
    insights.push({
      id: 'ready',
      severity: 'success',
      title: 'Your bench description is complete',
      detail: 'Every device has the values Labgrid needs. Download the generated files and follow the checklist.',
    });
  }

  return insights.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

function pduInsights(device: NetworkPduDevice, catalog: HardwareCatalog): Insight[] {
  const entry = findPdu(catalog, device.model);
  const insights: Insight[] = [];
  if (!entry) {
    insights.push({
      id: `pdu-unknown-model:${device.id}`,
      severity: 'critical',
      title: `Unknown PDU model "${device.model || '(empty)'}"`,
      detail:
        'NetworkPowerDriver imports labgrid.driver.power.<model> at runtime, so the model must be the exact backend name such as netio, gude8225 or shelly_gen2. Check the backend list and pick the file name that matches your device.',
      devices: [device.id],
      docs: [DOCS.powerBackends, DOCS.networkPowerPort],
    });
    return insights;
  }

  const base = entry.indexBase;
  const range = entry.indexMax !== undefined ? `${base} to ${entry.indexMax}` : `${base} upwards`;
  insights.push({
    id: `pdu-index-base:${device.id}`,
    severity: 'info',
    title: `${entry.family}: outlets count from ${base}`,
    detail: `The ${entry.model} backend numbers outlets ${range}. ${base === 0 ? 'The first outlet is index 0, so the label printed on the PDU is usually one higher than the Labgrid index.' : 'The first outlet is index 1, matching the label printed on most PDUs.'}`,
    devices: [device.id],
    docs: [DOCS.networkPowerPort],
  });

  if (device.index < base || (entry.indexMax !== undefined && device.index > entry.indexMax)) {
    insights.push({
      id: `pdu-index-out-of-range:${device.id}`,
      severity: 'critical',
      title: `Outlet ${device.index} is outside the range of ${entry.family}`,
      detail: `The ${entry.model} backend accepts indexes ${range}. Pick an outlet inside that range or the driver will reject the configuration.`,
      devices: [device.id],
      docs: [DOCS.powerBackends],
    });
  }

  const host = device.host.trim();
  if (host.length > 0) {
    const looksLikeUrl = /^https?:\/\//i.test(host);
    if (entry.hostFormat === 'url' && !looksLikeUrl) {
      insights.push({
        id: `pdu-host-format:${device.id}`,
        severity: 'warning',
        title: `${entry.family} expects a URL as host`,
        detail: `The ${entry.model} backend parses the host as a URL, for example http://${host}. Add the scheme (and credentials or port if the device needs them).`,
        devices: [device.id],
        docs: [DOCS.powerBackends],
      });
    } else if (entry.hostFormat === 'host' && host.includes('://')) {
      insights.push({
        id: `pdu-host-format:${device.id}`,
        severity: 'warning',
        title: `${entry.family} expects a plain hostname`,
        detail: `The ${entry.model} backend connects to a fixed port and does not parse URLs. Use just the hostname or IP address, without http://.`,
        devices: [device.id],
        docs: [DOCS.powerBackends],
      });
    }
  }

  if (entry.requirements && entry.requirements.length > 0) {
    insights.push({
      id: `pdu-requirements:${device.id}`,
      severity: 'info',
      title: `${entry.family} needs extra software`,
      detail: `The ${entry.model} backend needs, on the computer running the power driver: ${entry.requirements.join('; ')}.`,
      devices: [device.id],
      command: entry.requirements.find((requirement) => /^(pip|apt|sudo|export)/.test(requirement)),
      docs: [DOCS.powerBackends],
    });
  }

  const credentialNotes = (entry.notes ?? []).filter((note) => /credential|password|admin|community|login/i.test(note));
  if (credentialNotes.length > 0) {
    insights.push({
      id: `pdu-credentials:${device.id}`,
      severity: 'info',
      title: `${entry.family}: check credentials`,
      detail: credentialNotes.join(' '),
      devices: [device.id],
      docs: [DOCS.powerBackends],
    });
  }

  return insights;
}

function usbSerialInsights(device: UsbSerialDevice, catalog: HardwareCatalog): Insight[] {
  const entry = findUsb(catalog, device.usbId);
  if (!entry) return [];
  const insights: Insight[] = [];
  const usesSerialNumber = matchHasKey(device.match, 'ID_SERIAL_SHORT');
  const usesPath = matchHasKey(device.match, 'ID_PATH');

  if (usesSerialNumber && (entry.serialNumber === 'shared' || entry.serialNumber === 'none')) {
    insights.push({
      id: `shared-serial-number:${device.id}`,
      severity: 'warning',
      title: `${entry.product}: match by USB port instead of serial number`,
      detail:
        entry.serialNumber === 'none'
          ? `${entry.vendor} ${entry.product} adapters usually have no USB serial number, so ID_SERIAL_SHORT cannot tell two of them apart. Match on ID_PATH, the physical USB port path, and keep the adapter plugged into the same port.`
          : `Many ${entry.vendor} ${entry.product} adapters ship with the same serial number, so ID_SERIAL_SHORT may match the wrong device. Match on ID_PATH, the physical USB port path, and keep the adapter plugged into the same port.`,
      devices: [device.id],
      command: `udevadm info ${device.deviceNode ?? '/dev/ttyUSB0'} | grep -E 'ID_PATH|ID_SERIAL_SHORT'`,
      docs: [DOCS.udev],
    });
  }

  if (entry.multiInterface && !matchHasKey(device.match, 'ID_USB_INTERFACE_NUM') && !(usesPath && Object.keys(device.match).includes('ID_PATH'))) {
    insights.push({
      id: `multi-interface-serial:${device.id}`,
      severity: 'info',
      title: `${entry.product}: pick the UART with ID_USB_INTERFACE_NUM`,
      detail:
        'This chip exposes several UARTs behind one USB device, and they all share the serial number. Add ID_USB_INTERFACE_NUM ("00" for the first port, "01" for the second, and so on) to the match so Labgrid opens the right one.',
      devices: [device.id],
      command: `udevadm info ${device.deviceNode ?? '/dev/ttyUSB0'} | grep ID_USB_INTERFACE_NUM`,
      docs: [DOCS.udev],
    });
  }

  return insights;
}

function debuggerInsights(device: UsbDebuggerDevice, profile: BenchProfile, catalog: HardwareCatalog): Insight[] {
  const entry = findUsb(catalog, device.usbId);
  const insights: Insight[] = [];

  if (!device.interfaceConfig && !device.boardConfig) {
    insights.push({
      id: `openocd-config:${device.id}`,
      severity: 'warning',
      title: `Tell OpenOCD how to talk to "${device.label}"`,
      detail:
        `OpenOCDDriver needs interface_config and board_config (or a config list) to know the probe and the target.${entry?.openocdInterface ? ` For this probe the interface script is usually ${entry.openocdInterface}; the board script depends on your target, for example board/st_nucleo_f4.cfg.` : ' Look up the matching scripts in the OpenOCD scripts directory.'}`,
      devices: [device.id],
      docs: [DOCS.openocd],
    });
  }

  if (entry?.class === 'usb-debugger-with-serial') {
    const hasSerialSibling = profile.devices.some((other) => other.kind === 'usb-serial' && sameUsbId(other.usbId, device.usbId));
    if (!hasSerialSibling) {
      insights.push({
        id: `debugger-serial-port:${device.id}`,
        severity: 'info',
        title: `${entry.product} also provides a serial console`,
        detail:
          'This probe exposes a virtual COM port (usually /dev/ttyACM0) wired to the target UART. Add it as a USB serial console device so Labgrid can read boot messages while flashing with the same cable.',
        devices: [device.id],
        docs: [DOCS.configuration],
      });
    }
  }

  return insights;
}

function hubInsights(device: UsbHubPortDevice, board: BoardPreset | undefined): Insight[] {
  const insights: Insight[] = [];
  const path = device.match.ID_PATH ?? '';
  const pathNote = path.length > 0 && !/:\d+\.\d+$/.test(path)
    ? ` Your ID_PATH "${path}" does not end with an interface suffix such as :1.0; Labgrid needs the hub interface, otherwise the generic usb driver is matched instead of hub.`
    : ' The ID_PATH must point at the hub interface and normally ends with :1.0.';
  insights.push({
    id: `usb-hub-verify:${device.id}`,
    severity: 'warning',
    title: `Verify that "${device.label}" really switches port power`,
    detail:
      `Most USB hubs cannot switch VBUS on individual ports. Run "sudo uhubctl" on the computer the hub is plugged into: the hub must be listed and "uhubctl -l <location> -p ${device.index} -a off" must cut power to the board.${pathNote}`,
    devices: [device.id],
    command: 'sudo uhubctl',
    docs: [DOCS.uhubctl, DOCS.usbPowerPort],
  });

  if (board) {
    const usbPowered = board.power.inputs.some((input) => input === 'usb-c' || input === 'micro-usb');
    const highCurrent = /\b[3-5](\.\d+)?\s?A\b/.test(board.power.note ?? '') || board.family === 'raspberry-pi';
    if (usbPowered && highCurrent) {
      insights.push({
        id: `usb-hub-power-budget:${device.id}`,
        severity: 'warning',
        title: `${board.name} may draw more current than a hub port supplies`,
        detail:
          `${board.power.note ?? 'This board is powered over USB and needs a strong supply.'} Standard hub ports provide 0.5 A (USB 2) or 0.9 A (USB 3). If the board resets or shows under-voltage warnings, power it from its own adapter and switch that adapter with a PDU instead.`,
        devices: [device.id],
        docs: [DOCS.usbPowerPort],
      });
    }
  }

  return insights;
}

