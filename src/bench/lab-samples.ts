import { LAB_PROFILE_VERSION } from './types';
import type { Lab } from './types';

export interface SampleLab {
  id: string;
  title: string;
  description: string;
  lab: Lab;
}

/**
 * Example labs used by the "Try an example" action and by the Labgrid
 * validation script. Values are deliberately realistic but fake; udev match
 * values are distinct across benches because one device cannot be exported
 * twice.
 */
export const sampleLabs: SampleLab[] = [
  {
    id: 'rack-remote',
    title: 'Rack 3: three boards on one exporter',
    description: 'A Raspberry Pi 4 and an i.MX 8M Mini EVK on two outlets of the same NETIO PDU, plus an STM32 Nucleo on a YKUSH port, shared by a team through a coordinator.',
    lab: {
      version: LAB_PROFILE_VERSION,
      name: 'Rack 3',
      topology: 'remote',
      sharing: 'team',
      names: { exporterHost: 'rack3-pc', coordinator: 'coordinator.lab:20408', location: 'Rack 3' },
      benches: [
        {
          id: 'bench-1',
          board: { name: 'Raspberry Pi 4 Model B', presetId: 'raspberry-pi-4' },
          place: 'pi4-01',
          group: 'pi4-01',
          devices: [
            {
              id: 'dev-1',
              kind: 'usb-serial',
              label: 'Console',
              usbId: { vendorId: '10c4', productId: 'ea60' },
              match: { ID_PATH: 'pci-0000:00:14.0-usb-0:1.1:1.0' },
              speed: 115200,
              deviceNode: '/dev/ttyUSB0',
            },
            { id: 'dev-2', kind: 'network-pdu', label: 'PDU outlet 1', model: 'netio', host: 'netio-rack3.lab.example.org', index: 1 },
          ],
          login: { username: 'root', loginPrompt: ' login: ', prompt: 'root@[\\w-]+:[^ ]+ ' },
        },
        {
          id: 'bench-2',
          board: { name: 'NXP i.MX 8M Mini EVK', presetId: 'nxp-imx8mm-evk' },
          place: 'imx8mm-01',
          group: 'imx8mm-01',
          devices: [
            {
              id: 'dev-1',
              kind: 'usb-serial',
              label: 'Console',
              usbId: { vendorId: '0403', productId: '6011' },
              match: { ID_SERIAL_SHORT: 'FT6RQ2PA', ID_USB_INTERFACE_NUM: '02' },
              speed: 115200,
              deviceNode: '/dev/ttyUSB3',
            },
            { id: 'dev-2', kind: 'network-pdu', label: 'PDU outlet 2', model: 'netio', host: 'netio-rack3.lab.example.org', index: 2 },
            {
              id: 'dev-3',
              kind: 'imx-usb-loader',
              label: 'Serial download mode',
              usbId: { vendorId: '1fc9', productId: '0134' },
              match: { ID_PATH: 'pci-0000:00:14.0-usb-0:1.2' },
            },
          ],
          login: { username: 'root', loginPrompt: ' login: ', prompt: 'root@[\\w-]+:[^ ]+ ' },
          bootloader: { kind: 'uboot', prompt: 'u-boot=> ' },
        },
        {
          id: 'bench-3',
          board: { name: 'STM32 Nucleo-64', presetId: 'stm32-nucleo-64' },
          place: 'nucleo-01',
          group: 'nucleo-01',
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
            { id: 'dev-2', kind: 'ykush', label: 'YKUSH3 port 1', serial: 'Y3N00321', index: '1' },
            {
              id: 'dev-3',
              kind: 'usb-debugger',
              label: 'ST-LINK debug probe',
              usbId: { vendorId: '0483', productId: '374b' },
              match: { ID_SERIAL_SHORT: '066BFF3435504B3043061724' },
              interfaceConfig: 'interface/stlink.cfg',
              boardConfig: 'board/st_nucleo_f4.cfg',
            },
          ],
        },
      ],
    },
  },
  {
    id: 'desk-local',
    title: 'Two boards on this computer',
    description: 'A ZCU102 with its CP2108 console on a uhubctl-switched hub port, next to a BeaglePlay with a CP2102 console and manual power, both driven directly from this computer.',
    lab: {
      version: LAB_PROFILE_VERSION,
      name: 'Desk',
      topology: 'local',
      sharing: 'solo',
      names: { exporterHost: '', coordinator: '127.0.0.1:20408', location: '' },
      benches: [
        {
          id: 'bench-1',
          board: { name: 'AMD Xilinx ZCU102', presetId: 'amd-zcu102' },
          place: 'zcu102-01',
          group: 'zcu102-01',
          devices: [
            {
              id: 'dev-1',
              kind: 'usb-serial',
              label: 'Console',
              usbId: { vendorId: '10c4', productId: 'ea71' },
              match: { ID_SERIAL_SHORT: '01A2B3C4D5E6', ID_USB_INTERFACE_NUM: '00' },
              speed: 115200,
            },
            { id: 'dev-2', kind: 'usb-hub-port', label: 'Hub port 1', match: { ID_PATH: 'pci-0000:00:14.0-usb-0:3:1.0' }, index: 1 },
          ],
          login: { username: 'root', loginPrompt: ' login: ', prompt: 'root@[\\w-]+:[^ ]+ ' },
          bootloader: { kind: 'uboot', prompt: 'ZynqMP> ' },
        },
        {
          id: 'bench-2',
          board: { name: 'BeaglePlay', presetId: 'beagleplay' },
          place: 'beagleplay-01',
          group: 'beagleplay-01',
          devices: [
            {
              id: 'dev-1',
              kind: 'usb-serial',
              label: 'Console',
              usbId: { vendorId: '10c4', productId: 'ea60' },
              match: { ID_PATH: 'pci-0000:00:14.0-usb-0:4:1.0' },
              speed: 115200,
            },
            { id: 'dev-2', kind: 'manual-power', label: 'Manual power' },
          ],
          login: { username: 'debian', loginPrompt: ' login: ', prompt: 'debian@[\\w-]+:[^ ]+ ' },
          bootloader: { kind: 'uboot', prompt: '=> ' },
        },
      ],
    },
  },
];
