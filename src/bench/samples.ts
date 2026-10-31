import type { BenchProfile } from './types';
import { BENCH_PROFILE_VERSION } from './types';

export interface SampleBench {
  id: string;
  title: string;
  description: string;
  profile: BenchProfile;
}

/**
 * Example benches used by the "Try an example" action and by the
 * Labgrid validation script. Values are deliberately realistic but fake.
 */
export const sampleBenches: SampleBench[] = [
  {
    id: 'pi4-pdu-remote',
    title: 'Raspberry Pi 4 in a shared lab',
    description: 'CP210x console on the exporter host, a NETIO PDU on the Pi power supply, used by a team through a coordinator.',
    profile: {
      version: BENCH_PROFILE_VERSION,
      board: { name: 'Raspberry Pi 4 Model B', presetId: 'raspberry-pi-4' },
      topology: 'remote',
      sharing: 'team',
      names: { place: 'pi4-01', group: 'pi4-01', exporterHost: 'lab-exporter-1', coordinator: 'labgrid.lab.example.org:20408', location: 'Rack 2, shelf 3' },
      devices: [
        {
          id: 'dev-1',
          kind: 'usb-serial',
          label: 'Console',
          usbId: { vendorId: '10c4', productId: 'ea60' },
          match: { ID_PATH: 'pci-0000:00:14.0-usb-0:1.3:1.0' },
          speed: 115200,
          deviceNode: '/dev/ttyUSB0',
        },
        { id: 'dev-2', kind: 'network-pdu', label: 'PDU outlet', model: 'netio', host: 'netio-rack2.lab.example.org', index: 3 },
      ],
      login: { username: 'root', loginPrompt: ' login: ', prompt: 'root@[\\w-]+:[^ ]+ ' },
    },
  },
  {
    id: 'nucleo-stlink-local',
    title: 'STM32 Nucleo on this computer',
    description: 'ST-LINK/V2.1 debug probe with its virtual COM port, flashed with OpenOCD from the same machine.',
    profile: {
      version: BENCH_PROFILE_VERSION,
      board: { name: 'STM32 Nucleo-64', presetId: 'stm32-nucleo-64' },
      topology: 'local',
      sharing: 'solo',
      names: { place: 'nucleo-01', group: 'nucleo-01', exporterHost: '', coordinator: '127.0.0.1:20408', location: '' },
      devices: [
        {
          id: 'dev-1',
          kind: 'usb-serial',
          label: 'ST-LINK virtual COM port',
          usbId: { vendorId: '0483', productId: '374b' },
          match: { ID_SERIAL_SHORT: '066BFF3435504B3043061724' },
          speed: 115200,
          deviceNode: '/dev/ttyACM0',
        },
        {
          id: 'dev-2',
          kind: 'usb-debugger',
          label: 'ST-LINK debug probe',
          usbId: { vendorId: '0483', productId: '374b' },
          match: { ID_SERIAL_SHORT: '066BFF3435504B3043061724' },
          interfaceConfig: 'interface/stlink.cfg',
          boardConfig: 'board/st_nucleo_f4.cfg',
        },
        { id: 'dev-3', kind: 'manual-power', label: 'Manual power' },
      ],
    },
  },
  {
    id: 'imx8mm-ykush-remote',
    title: 'i.MX 8M Mini EVK with a YKUSH',
    description: 'FTDI console and a YKUSH3 switching the board USB power on a dedicated exporter host, used by one developer.',
    profile: {
      version: BENCH_PROFILE_VERSION,
      board: { name: 'NXP i.MX 8M Mini EVK', presetId: 'nxp-imx8mm-evk' },
      topology: 'remote',
      sharing: 'solo',
      names: { place: 'imx8mm-evk', group: 'imx8mm-evk', exporterHost: 'bench-pc', coordinator: '127.0.0.1:20408', location: '' },
      devices: [
        {
          id: 'dev-1',
          kind: 'usb-serial',
          label: 'Console',
          usbId: { vendorId: '0403', productId: '6001' },
          match: { ID_SERIAL_SHORT: 'A50285BI' },
          speed: 115200,
        },
        { id: 'dev-2', kind: 'ykush', label: 'YKUSH3 port 1', serial: 'Y3N12345', index: '1' },
        {
          id: 'dev-3',
          kind: 'imx-usb-loader',
          label: 'Serial download mode',
          usbId: { vendorId: '1fc9', productId: '0134' },
          match: { ID_PATH: 'pci-0000:00:14.0-usb-0:2.1' },
        },
      ],
      login: { username: 'root', loginPrompt: ' login: ', prompt: 'root@[\\w-]+:[^ ]+ ' },
      bootloader: { kind: 'uboot', prompt: '=> ' },
    },
  },
  {
    id: 'zcu102-hub-local',
    title: 'ZCU102 on a switchable USB hub',
    description: 'FT4232 quad UART with an explicit interface number, powered through a uhubctl-capable hub port, with a USB-SD-Mux for image exchange.',
    profile: {
      version: BENCH_PROFILE_VERSION,
      board: { name: 'AMD Xilinx ZCU102', presetId: 'amd-zcu102' },
      topology: 'local',
      sharing: 'solo',
      names: { place: 'zcu102', group: 'zcu102', exporterHost: '', coordinator: '127.0.0.1:20408', location: '' },
      devices: [
        {
          id: 'dev-1',
          kind: 'usb-serial',
          label: 'Console',
          usbId: { vendorId: '0403', productId: '6011' },
          match: { ID_SERIAL_SHORT: 'FT4ZU7KQ', ID_USB_INTERFACE_NUM: '00' },
          speed: 115200,
        },
        { id: 'dev-2', kind: 'usb-hub-port', label: 'Hub port 2', match: { ID_PATH: 'pci-0000:00:14.0-usb-0:2:1.0' }, index: 2 },
        { id: 'dev-3', kind: 'usb-sd-mux', label: 'USB-SD-Mux', match: { '@ID_PATH': 'pci-0000:00:14.0-usb-0:2.3' } },
      ],
      login: { username: 'root', loginPrompt: ' login: ', prompt: 'root@[\\w-]+:[^ ]+ ' },
      bootloader: { kind: 'uboot', prompt: 'ZynqMP> ' },
    },
  },
];
