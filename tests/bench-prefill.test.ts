import { describe, expect, it } from 'vitest';
import automatedSource from '../src/data/automated-hardware-testing.yaml?raw';
import firmwareSource from '../src/data/firmware-flashing.yaml?raw';
import powerSource from '../src/data/remote-power-control.yaml?raw';
import remoteAccessSource from '../src/data/remote-board-access.yaml?raw';
import serialSource from '../src/data/serial-console-access.yaml?raw';
import ciSource from '../src/data/ci-integration.yaml?raw';
import { applyPrefill, prefillAll, prefillForUseCase } from '../src/bench/prefill';
import { emptyProfile } from '../src/bench/profile';
import type { BenchDevice, BenchProfile, HardwareCatalog } from '../src/bench/types';
import { DecisionEngine } from '../src/engine/decision-engine';
import { loadDefinition } from '../src/engine/load';

const definitions = {
  power: loadDefinition(powerSource),
  serial: loadDefinition(serialSource),
  firmware: loadDefinition(firmwareSource),
  automated: loadDefinition(automatedSource),
  remoteAccess: loadDefinition(remoteAccessSource),
  ci: loadDefinition(ciSource),
};

const catalog: HardwareCatalog = {
  usbDevices: [],
  pduModels: [
    { model: 'netio', family: 'NETIO', indexBase: 1, hostFormat: 'host', confidence: 'source' },
    { model: 'gude8225', family: 'Gude Expert Power Control 8225', indexBase: 1, hostFormat: 'host', confidence: 'source' },
    { model: 'shelly_gen2', family: 'Shelly Gen2', indexBase: 0, hostFormat: 'url', confidence: 'source' },
  ],
  boards: [
    { id: 'raspberry-pi-4', name: 'Raspberry Pi 4', vendor: 'Raspberry Pi', family: 'raspberry-pi', console: { interface: 'uart-header', speed: 115200 }, power: { inputs: ['usb-c'] } },
    { id: 'imx8mm-evk', name: 'i.MX 8M Mini EVK', vendor: 'NXP', family: 'imx', console: { interface: 'onboard-usb', speed: 115200 }, power: { inputs: ['barrel'] } },
    { id: 'mixed', name: 'Mixed', vendor: 'X', family: 'x', console: { interface: 'none', speed: 115200 }, power: { inputs: ['usb-c', 'barrel'] } },
  ],
};

const console: BenchDevice = { id: 'c', label: 'Console', kind: 'usb-serial', usbId: { vendorId: '0403', productId: '6001' }, match: { ID_SERIAL_SHORT: 'A50285BI' }, speed: 115200, deviceNode: '/dev/ttyUSB0' };
const netio: BenchDevice = { id: 'p', label: 'PDU', kind: 'network-pdu', model: 'netio', host: 'netio1', index: 3 };

function profile(overrides: Partial<BenchProfile> = {}, devices: BenchDevice[] = []): BenchProfile {
  return { ...emptyProfile(), ...overrides, devices };
}

function assertValid(definition: typeof definitions.power, answers: Record<string, string>): void {
  for (const [questionId, value] of Object.entries(answers)) {
    const question = definition.questions.find(({ id }) => id === questionId);
    expect(question, `question ${questionId}`).toBeDefined();
    expect(question?.options.map((option) => option.value)).toContain(value);
  }
}

describe('bench prefill', () => {
  it('fills the remote power wizard for a PDU on a remote team bench', () => {
    const bench = profile(
      { board: { name: 'i.MX8MM EVK', presetId: 'imx8mm-evk' }, topology: 'remote', sharing: 'team', names: { ...emptyProfile().names, place: 'evk-1', group: 'evk-1', exporterHost: 'rack-pc', location: 'Rack 3' } },
      [console, netio],
    );
    const prefill = prefillForUseCase(bench, definitions.power, catalog);
    expect(prefill.answers).toEqual({
      'power-source': 'external-adapter',
      'output-count': 'one',
      controller: 'network-pdu',
      location: 'remote-lab',
      'pdu-model': 'netio',
    });
    expect(prefill.values).toMatchObject({ PLACE_NAME: 'evk-1', EXPORT_GROUP: 'evk-1', PHYSICAL_LOCATION: 'Rack 3', PDU_HOST: 'netio1', PDU_OUTLET_INDEX: '3', BOARD_NAME: 'i.MX8MM EVK' });
    expect(prefill.relevance).toContain('NETIO');

    const answers = applyPrefill(definitions.power, prefill.answers);
    const engine = new DecisionEngine(definitions.power);
    expect(engine.answerStatus(answers).complete).toBe(true);
    expect(engine.configurations(answers).map(({ definition }) => definition.id)).toEqual(['remote-network-pdu-exporter', 'remote-network-pdu-client']);
  });

  it('maps other controllers and PDU families', () => {
    const ykush: BenchDevice = { id: 'y', label: 'YKUSH', kind: 'ykush', serial: 'Y3N1', index: '2' };
    const hub: BenchDevice = { id: 'h', label: 'Hub', kind: 'usb-hub-port', match: { ID_PATH: 'pci-0000:00:14.0-usb-0:2:1.0' }, index: 4 };
    const pi = { board: { name: 'Pi', presetId: 'raspberry-pi-4' } };
    const ykushPrefill = prefillForUseCase(profile(pi, [ykush]), definitions.power, catalog);
    expect(ykushPrefill.answers).toMatchObject({ 'power-source': 'usb', controller: 'ykush', location: 'local', 'output-count': 'one' });
    expect(ykushPrefill.values).toMatchObject({ YKUSH_SERIAL: 'Y3N1', YKUSH_PORT_INDEX: '2' });
    const hubPrefill = prefillForUseCase(profile({ ...pi, topology: 'remote' }, [hub, ykush]), definitions.power, catalog);
    expect(hubPrefill.answers).toMatchObject({ controller: 'smart-usb-hub', 'output-count': 'multiple', location: 'remote-host' });
    expect(hubPrefill.values).toMatchObject({ UDEV_ID_PATH: 'pci-0000:00:14.0-usb-0:2:1.0', USB_PORT_INDEX: '4' });
    const gude: BenchDevice = { ...netio, model: 'gude8225' };
    expect(prefillForUseCase(profile({}, [gude]), definitions.power, catalog).answers['pdu-model']).toBe('gude');
    const shelly: BenchDevice = { ...netio, model: 'shelly_gen2', host: 'http://192.168.0.42', index: 0 };
    expect(prefillForUseCase(profile({}, [shelly]), definitions.power, catalog).answers['pdu-model']).toBe('unknown');
    const manual: BenchDevice = { id: 'm', label: 'Manual', kind: 'manual-power' };
    expect(prefillForUseCase(profile({}, [manual]), definitions.power, catalog).answers.controller).toBe('none');
    expect(prefillForUseCase(profile({ board: { name: 'Mixed', presetId: 'mixed' } }, [manual]), definitions.power, catalog).answers['power-source']).toBeUndefined();
    expect(prefillForUseCase(profile(), definitions.power, catalog).relevance).toBeUndefined();
  });

  it('fills the serial console wizard from USB and network consoles', () => {
    const usb = prefillForUseCase(profile({}, [console]), definitions.serial, catalog);
    expect(usb.answers).toEqual({ 'serial-hardware': 'usb-adapter', location: 'local' });
    expect(usb.values).toMatchObject({ SERIAL_NUMBER: 'A50285BI', BAUD_RATE: '115200' });
    const network: BenchDevice = { id: 'n', label: 'Console', kind: 'network-serial', host: 'ser2net.lab', port: 4001, speed: 57600, protocol: 'raw' };
    const net = prefillForUseCase(profile({ topology: 'remote' }, [network]), definitions.serial, catalog);
    expect(net.answers).toEqual({ 'serial-hardware': 'network-server', 'network-protocol': 'raw', location: 'remote' });
    expect(net.values).toMatchObject({ SERIAL_HOST: 'ser2net.lab', SERIAL_PORT: '4001', BAUD_RATE: '57600' });
    expect(new DecisionEngine(definitions.serial).answerStatus(applyPrefill(definitions.serial, net.answers)).complete).toBe(true);
  });

  it('fills firmware flashing from the debug device', () => {
    const probe: BenchDevice = { id: 'd', label: 'Probe', kind: 'usb-debugger', match: { '@ID_PATH': 'pci-0000:00:14.0-usb-0:3' }, interfaceConfig: 'interface/stlink.cfg', boardConfig: 'board/st_nucleo_f4.cfg' };
    const openocd = prefillForUseCase(profile({}, [probe]), definitions.firmware, catalog);
    expect(openocd.answers).toEqual({ 'flash-method': 'openocd', location: 'local' });
    expect(openocd.values).toMatchObject({ UDEV_ID_PATH: 'pci-0000:00:14.0-usb-0:3', INTERFACE_CONFIG: 'interface/stlink.cfg', BOARD_CONFIG: 'board/st_nucleo_f4.cfg' });
    const fastboot: BenchDevice = { id: 'f', label: 'Fastboot', kind: 'fastboot', match: { ID_PATH: 'x' }, usbId: { vendorId: '18d1', productId: '4ee0' } };
    const fb = prefillForUseCase(profile({ topology: 'remote' }, [fastboot]), definitions.firmware, catalog);
    expect(fb.answers).toEqual({ 'flash-method': 'fastboot', location: 'remote' });
    expect(fb.values).toMatchObject({ USB_VENDOR_ID: '18d1', USB_PRODUCT_ID: '4ee0' });
    expect(prefillForUseCase(profile({}, [console]), definitions.firmware, catalog).answers).toEqual({});
  });

  it('fills testing and access wizards from login and sharing', () => {
    const login = { username: 'root', prompt: 'root@[\\w-]+:[^ ]+ ', loginPrompt: ' login: ' };
    const shell = prefillForUseCase(profile({ login, topology: 'remote', sharing: 'team' }, [console]), definitions.automated, catalog);
    expect(shell.answers).toEqual({ 'test-level': 'shell', topology: 'shared' });
    expect(shell.values).toMatchObject({ SHELL_PROMPT: login.prompt, LOGIN_PROMPT: ' login: ', USERNAME: 'root', SERIAL_DEVICE: '/dev/ttyUSB0' });
    const plain = prefillForUseCase(profile({}, [console]), definitions.automated, catalog);
    expect(plain.answers).toEqual({ 'test-level': 'console', topology: 'local' });
    const access = prefillForUseCase(profile({ login, sharing: 'team', topology: 'remote' }, [console]), definitions.remoteAccess, catalog);
    expect(access.answers).toEqual({ 'access-level': 'shell', sharing: 'pooled-users' });
    expect(prefillForUseCase(profile(), definitions.remoteAccess, catalog).answers.sharing).toBe('named-users');
  });

  it('only provides values for CI and never answers questions', () => {
    const ci = prefillForUseCase(profile({ topology: 'remote', sharing: 'team' }), definitions.ci, catalog);
    expect(ci.answers).toEqual({});
    expect(ci.values).toMatchObject({ PLACE_NAME: 'board-01', ALLOCATED_PLACE: 'board-01' });
    expect(ci.relevance).toBeDefined();
    expect(prefillForUseCase(profile(), definitions.ci, catalog).relevance).toBeUndefined();
  });

  it('never emits answers that the definition does not offer', () => {
    const trimmed = { ...definitions.power, questions: definitions.power.questions.filter(({ id }) => id !== 'output-count').map((question) => question.id === 'controller' ? { ...question, options: question.options.filter(({ value }) => value !== 'network-pdu') } : question) };
    const prefill = prefillForUseCase(profile({}, [netio]), trimmed, catalog);
    expect(prefill.answers['output-count']).toBeUndefined();
    expect(prefill.answers.controller).toBeUndefined();
    assertValid(trimmed, prefill.answers);
    expect(() => applyPrefill(trimmed, { controller: 'network-pdu', bogus: 'x', location: 'local' })).not.toThrow();
    expect(applyPrefill(trimmed, { controller: 'network-pdu', bogus: 'x', location: 'local' })).toEqual({ location: 'local' });
  });

  it('prefills every definition with valid answers', () => {
    const bench = profile({ topology: 'remote', sharing: 'team', login: { username: 'root', prompt: 'x ', loginPrompt: ' login: ' } }, [console, netio]);
    const all = prefillAll(bench, Object.values(definitions), catalog);
    expect(all.map(({ useCaseId }) => useCaseId)).toEqual(Object.values(definitions).map(({ id }) => id));
    for (const prefill of all) {
      const definition = Object.values(definitions).find(({ id }) => id === prefill.useCaseId)!;
      assertValid(definition, prefill.answers);
      expect(Object.values(prefill.values).every((value) => value.length > 0)).toBe(true);
    }
  });
});
