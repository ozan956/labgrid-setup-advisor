import { describe, expect, it } from 'vitest';
import { analyzeProfile } from '../src/bench/insights';
import { emptyProfile } from '../src/bench/profile';
import type { BenchDevice, BenchProfile, HardwareCatalog } from '../src/bench/types';

const catalog: HardwareCatalog = {
  usbDevices: [
    { vendorId: '10c4', productIds: ['ea60'], vendor: 'Silicon Labs', product: 'CP210x UART bridge', class: 'usb-serial', chip: 'cp210x', serialNumber: 'shared' },
    { vendorId: '0403', productIds: ['6001'], vendor: 'FTDI', product: 'FT232R', class: 'usb-serial', chip: 'ftdi', serialNumber: 'usually-unique' },
    { vendorId: '0403', productIds: ['6010'], vendor: 'FTDI', product: 'FT2232', class: 'usb-serial', chip: 'ftdi', serialNumber: 'usually-unique', multiInterface: true },
    { vendorId: '0483', productIds: ['374b'], vendor: 'STMicroelectronics', product: 'ST-LINK/V2.1', class: 'usb-debugger-with-serial', chip: 'stlink', openocdInterface: 'interface/stlink.cfg' },
  ],
  pduModels: [
    { model: 'netio', family: 'NETIO', indexBase: 1, indexMax: 4, hostFormat: 'host', notes: ['Uses the hardcoded admin:admin credentials.'], confidence: 'source' },
    { model: 'shelly_gen2', family: 'Shelly Gen2', indexBase: 0, hostFormat: 'url', confidence: 'source' },
    { model: 'eaton', family: 'Eaton ePDU', indexBase: 1, indexMax: 16, hostFormat: 'host', requirements: ['pip install "labgrid[snmp]"'], confidence: 'source' },
    { model: 'tapo', family: 'TP-Link Tapo', indexBase: 0, hostFormat: 'host', requirements: ['KASA_USERNAME and KASA_PASSWORD environment variables'], confidence: 'source' },
  ],
  boards: [
    {
      id: 'raspberry-pi-4', name: 'Raspberry Pi 4 Model B', vendor: 'Raspberry Pi', family: 'raspberry-pi', verification: 'docs',
      console: { interface: 'uart-header', speed: 115200, note: 'Use a 3.3 V USB-UART adapter on GPIO 14/15 and set enable_uart=1.' },
      power: { inputs: ['usb-c'], note: 'Needs 5 V / 3 A over USB-C.' },
      bootloader: { kind: 'uboot', prompt: 'U-Boot> ', note: 'Only when you install U-Boot yourself.' },
    },
    { id: 'stm32-nucleo-64', name: 'STM32 Nucleo-64', vendor: 'ST', family: 'stm32', verification: 'docs', console: { interface: 'cdc-acm', speed: 115200, chip: 'stlink' }, power: { inputs: ['micro-usb'] } },
    {
      id: 'imported-board', name: 'Imported board', vendor: 'X', family: 'x', verification: 'unverified', sources: ['u-boot: configs/imported_defconfig'],
      console: { interface: 'uart-header', speed: 115200 }, power: { inputs: ['other'] }, bootloader: { kind: 'uboot', prompt: '=> ' },
    },
  ],
};

function profile(overrides: Partial<BenchProfile> = {}, devices: BenchDevice[] = []): BenchProfile {
  return { ...emptyProfile(), ...overrides, devices };
}

const cp210x: BenchDevice = { id: 'dev-1', label: 'Console', kind: 'usb-serial', usbId: { vendorId: '10c4', productId: 'ea60' }, match: { ID_SERIAL_SHORT: '0001' }, speed: 115200, deviceNode: '/dev/ttyUSB0' };
const ftdi: BenchDevice = { id: 'dev-2', label: 'Console', kind: 'usb-serial', usbId: { vendorId: '0403', productId: '6001' }, match: { ID_SERIAL_SHORT: 'A50285BI' }, speed: 115200 };
const netio: BenchDevice = { id: 'dev-3', label: 'PDU', kind: 'network-pdu', model: 'netio', host: 'netio1', index: 3 };

const ids = (insights: ReturnType<typeof analyzeProfile>) => insights.map(({ id }) => id.split(':')[0]);

describe('bench insights', () => {
  it('flags an empty bench with missing console and power', () => {
    const found = ids(analyzeProfile(profile(), catalog));
    expect(found).toContain('no-console');
    expect(found).toContain('no-power');
    expect(found).not.toContain('ready');
  });

  it('declares a complete FTDI console with a PDU ready', () => {
    const insights = analyzeProfile(profile({}, [ftdi, netio]), catalog);
    const found = ids(insights);
    expect(found).toContain('ready');
    expect(found).toContain('pdu-index-base');
    expect(found).toContain('pdu-credentials');
    expect(found).not.toContain('shared-serial-number');
    expect(found).not.toContain('no-console');
    expect(insights[0].severity).not.toBe('success');
    expect(insights.at(-1)?.severity).toBe('success');
  });

  it('warns about shared CP210x serial numbers only when matched by serial', () => {
    expect(ids(analyzeProfile(profile({}, [cp210x]), catalog))).toContain('shared-serial-number');
    const byPath: BenchDevice = { ...cp210x, match: { ID_PATH: 'pci-0000:00:14.0-usb-0:1.3:1.0' } };
    expect(ids(analyzeProfile(profile({}, [byPath]), catalog))).not.toContain('shared-serial-number');
  });

  it('asks for ID_USB_INTERFACE_NUM on multi-interface chips', () => {
    const ft2232: BenchDevice = { ...ftdi, usbId: { vendorId: '0403', productId: '6010' } };
    expect(ids(analyzeProfile(profile({}, [ft2232]), catalog))).toContain('multi-interface-serial');
    const withInterface: BenchDevice = { ...ft2232, match: { ID_SERIAL_SHORT: 'X', ID_USB_INTERFACE_NUM: '01' } };
    expect(ids(analyzeProfile(profile({}, [withInterface]), catalog))).not.toContain('multi-interface-serial');
  });

  it('reports missing match values, serials, and hosts as critical', () => {
    const devices: BenchDevice[] = [
      { ...ftdi, id: 'a', match: { ID_SERIAL_SHORT: '' } },
      { id: 'b', label: 'YKUSH', kind: 'ykush', serial: '', index: '1' },
      { ...netio, id: 'c', host: ' ' },
    ];
    const insights = analyzeProfile(profile({}, devices), catalog);
    const missing = insights.filter(({ id }) => id.startsWith('missing-match'));
    expect(missing.map(({ devices: d }) => d?.[0])).toEqual(['a', 'b', 'c']);
    expect(missing.every(({ severity }) => severity === 'critical')).toBe(true);
    expect(ids(insights)).not.toContain('ready');
  });

  it('suggests the virtual COM port and OpenOCD scripts for an ST-Link', () => {
    const probe: BenchDevice = { id: 'p', label: 'Probe', kind: 'usb-debugger', usbId: { vendorId: '0483', productId: '374b' }, match: { ID_PATH: 'x' } };
    const insights = analyzeProfile(profile({}, [probe]), catalog);
    expect(ids(insights)).toContain('debugger-serial-port');
    const openocd = insights.find(({ id }) => id.startsWith('openocd-config'));
    expect(openocd?.detail).toContain('interface/stlink.cfg');
    const serial: BenchDevice = { id: 's', label: 'Console', kind: 'usb-serial', usbId: { vendorId: '0483', productId: '374b' }, match: { ID_PATH: 'y' }, speed: 115200 };
    const configured: BenchDevice = { ...probe, interfaceConfig: 'interface/stlink.cfg', boardConfig: 'board/st_nucleo_f4.cfg' };
    const quiet = ids(analyzeProfile(profile({}, [configured, serial]), catalog));
    expect(quiet).not.toContain('debugger-serial-port');
    expect(quiet).not.toContain('openocd-config');
  });

  it('asks to verify uhubctl hubs and warns about the Pi power budget', () => {
    const hub: BenchDevice = { id: 'h', label: 'Hub port', kind: 'usb-hub-port', match: { ID_PATH: 'pci-0000:00:14.0-usb-0:2' }, index: 1 };
    const insights = analyzeProfile(profile({ board: { name: 'Pi', presetId: 'raspberry-pi-4' } }, [hub]), catalog);
    const verify = insights.find(({ id }) => id.startsWith('usb-hub-verify'));
    expect(verify?.detail).toContain(':1.0');
    expect(ids(insights)).toContain('usb-hub-power-budget');
    expect(ids(analyzeProfile(profile({ board: { name: 'Nucleo', presetId: 'stm32-nucleo-64' } }, [hub]), catalog))).not.toContain('usb-hub-power-budget');
  });

  it('explains YKUSH tooling', () => {
    const ykush: BenchDevice = { id: 'y', label: 'YKUSH', kind: 'ykush', serial: 'Y3N12345', index: '2' };
    const insight = analyzeProfile(profile({}, [ykush]), catalog).find(({ id }) => id === 'ykush-tools');
    expect(insight?.command).toBe('ykushcmd ykush3 -l');
  });

  it('checks PDU index ranges, host formats, requirements, and unknown models', () => {
    const outOfRange: BenchDevice = { ...netio, index: 5 };
    expect(ids(analyzeProfile(profile({}, [outOfRange]), catalog))).toContain('pdu-index-out-of-range');
    const shelly: BenchDevice = { id: 's', label: 'Shelly', kind: 'network-pdu', model: 'shelly_gen2', host: '192.168.0.42', index: 0 };
    expect(ids(analyzeProfile(profile({}, [shelly]), catalog))).toContain('pdu-host-format');
    expect(ids(analyzeProfile(profile({}, [{ ...shelly, host: 'http://192.168.0.42' }]), catalog))).not.toContain('pdu-host-format');
    expect(ids(analyzeProfile(profile({}, [{ ...netio, host: 'http://netio1' }]), catalog))).toContain('pdu-host-format');
    const eaton: BenchDevice = { ...netio, id: 'e', model: 'eaton', index: 1 };
    const requirements = analyzeProfile(profile({}, [eaton]), catalog).find(({ id }) => id.startsWith('pdu-requirements'));
    expect(requirements?.detail).toContain('labgrid[snmp]');
    const unknown = analyzeProfile(profile({}, [{ ...netio, id: 'u', model: 'mystery' }]), catalog);
    expect(unknown[0].id).toBe('pdu-unknown-model:u');
    expect(unknown[0].severity).toBe('critical');
    expect(ids(unknown)).not.toContain('pdu-index-base');
  });

  it('adds remote and team guidance', () => {
    const remote = profile({ topology: 'remote', sharing: 'team', names: { ...emptyProfile().names, exporterHost: '', coordinator: 'lab.example:20408' } }, [ftdi]);
    const found = ids(analyzeProfile(remote, catalog));
    expect(found).toEqual(expect.arrayContaining(['remote-exporter-name', 'remote-exporter-tools', 'remote-coordinator-address', 'team-sharing']));
    const local = ids(analyzeProfile(profile({}, [ftdi]), catalog));
    expect(local).not.toContain('remote-exporter-tools');
    expect(local).not.toContain('team-sharing');
    const named = profile({ topology: 'remote', names: { ...emptyProfile().names, exporterHost: 'bench-pc' } }, [ftdi]);
    expect(ids(analyzeProfile(named, catalog))).not.toContain('remote-exporter-name');
    expect(ids(analyzeProfile(named, catalog))).not.toContain('remote-coordinator-address');
  });

  it('rejects invalid place names', () => {
    const bad = profile({ names: { ...emptyProfile().names, place: 'my board' } }, [ftdi]);
    const insights = analyzeProfile(bad, catalog);
    expect(insights[0].id).toBe('invalid-name');
    expect(ids(insights)).not.toContain('ready');
  });

  it('surfaces board preset hints', () => {
    const found = ids(analyzeProfile(profile({ board: { name: 'Pi', presetId: 'raspberry-pi-4' } }, [ftdi]), catalog));
    expect(found).toEqual(expect.arrayContaining(['board-console-hint', 'board-power-hint', 'board-bootloader-hint']));
    const withBootloader = profile({ board: { name: 'Pi', presetId: 'raspberry-pi-4' }, bootloader: { kind: 'uboot', prompt: 'U-Boot> ' } }, [ftdi]);
    expect(ids(analyzeProfile(withBootloader, catalog))).not.toContain('board-bootloader-hint');
  });

  it('warns when the chosen preset was imported and not yet reviewed', () => {
    const imported = analyzeProfile(profile({ board: { name: 'Imported', presetId: 'imported-board' } }, [ftdi]), catalog);
    const warning = imported.find((insight) => insight.id === 'board-unverified');
    expect(warning?.severity).toBe('warning');
    expect(warning?.detail).toContain('configs/imported_defconfig');
    expect(warning?.detail).toContain('"=> "');
    expect(ids(analyzeProfile(profile({ board: { name: 'Pi', presetId: 'raspberry-pi-4' } }, [ftdi]), catalog))).not.toContain('board-unverified');
  });

  it('links login settings to a console and announces strategies', () => {
    const login = { username: 'root', prompt: 'root@[\\w-]+:[^ ]+ ', loginPrompt: ' login: ' };
    expect(ids(analyzeProfile(profile({ login }), catalog))).toContain('login-without-console');
    const full = analyzeProfile(profile({ login, bootloader: { kind: 'uboot', prompt: '=> ' } }, [ftdi, netio]), catalog);
    expect(ids(full)).not.toContain('login-without-console');
    expect(full.find(({ id }) => id === 'strategy-ready')?.detail).toContain('UBootStrategy');
    const shell = analyzeProfile(profile({ login }, [ftdi, netio]), catalog);
    expect(shell.find(({ id }) => id === 'strategy-ready')?.detail).toContain('ShellStrategy');
    expect(ids(analyzeProfile(profile({}, [ftdi, netio]), catalog))).not.toContain('strategy-ready');
  });

  it('lists unsupported devices without blocking readiness', () => {
    const dongle: BenchDevice = { id: 'd', label: 'Dell receiver', kind: 'unsupported-usb', usbId: { vendorId: '413c', productId: '4503' } };
    const found = ids(analyzeProfile(profile({}, [ftdi, dongle]), catalog));
    expect(found).toContain('unsupported-devices');
    expect(found).toContain('ready');
  });
});

describe('review fixes', () => {
  it('warns that manual power is ignored next to a real controller', () => {
    const manual: BenchDevice = { id: 'dev-9', label: 'Hand switch', kind: 'manual-power' };
    const found = ids(analyzeProfile(profile({}, [ftdi, netio, manual]), catalog));
    expect(found).toContain('redundant-manual-power');
    expect(ids(analyzeProfile(profile({}, [ftdi, manual]), catalog))).not.toContain('redundant-manual-power');
  });

  it('does not call the bench complete while login lacks a console', () => {
    const withLogin = profile({ login: { username: 'root', prompt: 'root@[\\w-]+:[^ ]+ ', loginPrompt: ' login: ' } }, [netio]);
    const found = ids(analyzeProfile(withLogin, catalog));
    expect(found).toContain('login-without-console');
    expect(found).not.toContain('ready');
    expect(found).not.toContain('strategy-ready');
  });

  it('links reservations to an existing documentation page', () => {
    const insights = analyzeProfile(profile({ topology: 'remote', sharing: 'team', names: { ...emptyProfile().names, exporterHost: 'lab' } }, [ftdi]), catalog);
    for (const insight of insights) for (const doc of insight.docs ?? []) expect(doc.url).not.toContain('#places-and-reservations');
  });
});
