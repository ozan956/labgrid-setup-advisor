import { DecisionEngine } from '../engine/decision-engine';
import type { Answers, UseCaseDefinition } from '../engine/types';
import { findBoard as findBoardEntry, findPduModel } from './catalog';
import { devicesWithRole } from './profile';
import type {
  BenchDevice,
  BenchProfile,
  BoardPreset,
  HardwareCatalog,
  PduModelEntry,
  Prefill,
  UdevMatch,
} from './types';

type Values = Record<string, string>;

function findBoard(catalog: HardwareCatalog, id: string | undefined): BoardPreset | undefined {
  return id ? findBoardEntry(catalog, id) : undefined;
}

function findPdu(catalog: HardwareCatalog, model: string): PduModelEntry | undefined {
  return findPduModel(catalog, model);
}

function optionExists(definition: UseCaseDefinition, questionId: string, value: string | undefined): value is string {
  if (value === undefined) return false;
  const question = definition.questions.find(({ id }) => id === questionId);
  return question?.options.some((option) => option.value === value) ?? false;
}

function setValue(values: Values, token: string, value: string | number | undefined): void {
  if (value === undefined) return;
  const text = String(value);
  // Prompts such as ' login: ' carry significant whitespace, so only emptiness is checked.
  if (text.trim().length > 0) values[token] = text;
}

function matchValue(match: UdevMatch, key: string): string | undefined {
  const value = match[key] ?? match[`@${key}`];
  return value && value.trim().length > 0 ? value : undefined;
}

function pathValue(match: UdevMatch): string | undefined {
  return matchValue(match, 'ID_PATH');
}

function powerSourceFromBoard(board: BoardPreset | undefined): string | undefined {
  if (!board) return undefined;
  const inputs = board.power.inputs.filter((input) => input !== 'other');
  if (inputs.length === 0) return undefined;
  const usb = inputs.every((input) => input === 'usb-c' || input === 'micro-usb');
  const external = inputs.every((input) => input === 'barrel' || input === 'poe' || input === 'atx');
  if (usb) return 'usb';
  if (external) return 'external-adapter';
  return undefined;
}

function controllerFor(device: BenchDevice): string | undefined {
  switch (device.kind) {
    case 'ykush':
      return 'ykush';
    case 'usb-hub-port':
      return 'smart-usb-hub';
    case 'network-pdu':
      return 'network-pdu';
    case 'manual-power':
      return 'none';
    default:
      return undefined;
  }
}

function pduFamilyAnswer(model: string): string {
  if (model === 'netio' || model === 'netio_kshell') return 'netio';
  if (model.startsWith('gude')) return 'gude';
  if (model === 'eaton') return 'eaton';
  if (model === 'apc') return 'apc';
  return 'unknown';
}

function flashMethodFor(device: BenchDevice): string | undefined {
  switch (device.kind) {
    case 'usb-debugger':
      return 'openocd';
    case 'dfu':
      return 'dfu';
    case 'fastboot':
      return 'fastboot';
    default:
      return undefined;
  }
}

function describePower(device: BenchDevice, catalog: HardwareCatalog): string {
  switch (device.kind) {
    case 'network-pdu':
      return `a ${findPdu(catalog, device.model)?.family ?? device.model} PDU`;
    case 'ykush':
      return 'a Yepkit YKUSH';
    case 'usb-hub-port':
      return 'a USB hub port switched with uhubctl';
    case 'manual-power':
      return 'manual power control';
    default:
      return device.label;
  }
}

function describeDebug(device: BenchDevice): string {
  switch (device.kind) {
    case 'usb-debugger':
      return 'an OpenOCD-compatible debug probe';
    case 'dfu':
      return 'a device in DFU mode';
    case 'fastboot':
      return 'a fastboot device';
    default:
      return device.label;
  }
}

function commonValues(profile: BenchProfile): Values {
  const values: Values = {};
  setValue(values, 'PLACE_NAME', profile.names.place);
  setValue(values, 'EXPORT_GROUP', profile.names.group || profile.names.place);
  setValue(values, 'PHYSICAL_LOCATION', profile.names.location);
  return values;
}

function consoleValues(profile: BenchProfile, values: Values): void {
  const console = devicesWithRole(profile, 'console')[0];
  if (!console) return;
  if (console.kind === 'usb-serial') {
    setValue(values, 'SERIAL_NUMBER', matchValue(console.match, 'ID_SERIAL_SHORT'));
    setValue(values, 'SERIAL_DEVICE', console.deviceNode);
    setValue(values, 'BAUD_RATE', console.speed);
  } else if (console.kind === 'network-serial') {
    setValue(values, 'SERIAL_HOST', console.host);
    setValue(values, 'SERIAL_PORT', console.port);
    setValue(values, 'BAUD_RATE', console.speed);
  }
}

function loginValues(profile: BenchProfile, values: Values): void {
  if (!profile.login) return;
  setValue(values, 'SHELL_PROMPT', profile.login.prompt);
  setValue(values, 'LOGIN_PROMPT', profile.login.loginPrompt);
  setValue(values, 'USERNAME', profile.login.username);
}

export function prefillForUseCase(profile: BenchProfile, definition: UseCaseDefinition, catalog: HardwareCatalog): Prefill {
  const answers: Record<string, string> = {};
  const values = commonValues(profile);
  const board = findBoard(catalog, profile.board.presetId);
  const consoles = devicesWithRole(profile, 'console');
  const power = devicesWithRole(profile, 'power');
  const debug = devicesWithRole(profile, 'debug');
  const remote = profile.topology === 'remote';
  let relevance: string | undefined;

  const answer = (questionId: string, value: string | undefined): void => {
    if (optionExists(definition, questionId, value)) answers[questionId] = value;
  };

  switch (definition.id) {
    case 'remote-power-control': {
      answer('power-source', powerSourceFromBoard(board));
      answer('output-count', power.length > 1 ? 'multiple' : 'one');
      const primary = power[0];
      if (primary) answer('controller', controllerFor(primary));
      answer('location', !remote ? 'local' : profile.sharing === 'team' ? 'remote-lab' : 'remote-host');
      const pdu = power.find((device) => device.kind === 'network-pdu');
      if (pdu && pdu.kind === 'network-pdu') {
        answer('pdu-model', pduFamilyAnswer(pdu.model));
        setValue(values, 'PDU_HOST', pdu.host);
        setValue(values, 'PDU_OUTLET_INDEX', pdu.index);
      }
      const ykush = power.find((device) => device.kind === 'ykush');
      if (ykush && ykush.kind === 'ykush') {
        setValue(values, 'YKUSH_SERIAL', ykush.serial);
        setValue(values, 'YKUSH_PORT_INDEX', ykush.index);
      }
      const hub = power.find((device) => device.kind === 'usb-hub-port');
      if (hub && hub.kind === 'usb-hub-port') {
        setValue(values, 'UDEV_ID_PATH', pathValue(hub.match));
        setValue(values, 'USB_PORT_INDEX', hub.index);
      }
      setValue(values, 'BOARD_NAME', profile.board.name || profile.names.place);
      if (primary) relevance = `You have ${describePower(primary, catalog)}.`;
      break;
    }
    case 'serial-console-access': {
      const console = consoles[0];
      if (console) {
        answer('serial-hardware', console.kind === 'usb-serial' ? 'usb-adapter' : 'network-server');
        if (console.kind === 'network-serial') answer('network-protocol', console.protocol);
        answer('location', remote ? 'remote' : 'local');
        relevance = console.kind === 'usb-serial' ? 'You have a USB serial console.' : 'You have a network serial console.';
      }
      consoleValues(profile, values);
      break;
    }
    case 'firmware-flashing': {
      const probe = debug[0];
      if (probe) {
        answer('flash-method', flashMethodFor(probe));
        answer('location', remote ? 'remote' : 'local');
        if ('match' in probe) setValue(values, 'UDEV_ID_PATH', pathValue(probe.match));
        if (probe.kind === 'usb-debugger') {
          setValue(values, 'INTERFACE_CONFIG', probe.interfaceConfig);
          setValue(values, 'BOARD_CONFIG', probe.boardConfig);
        }
        if (probe.kind === 'fastboot') {
          setValue(values, 'USB_VENDOR_ID', probe.usbId.vendorId);
          setValue(values, 'USB_PRODUCT_ID', probe.usbId.productId);
        }
        relevance = `You have ${describeDebug(probe)}.`;
      }
      break;
    }
    case 'automated-hardware-testing': {
      answer('test-level', profile.login ? 'shell' : 'console');
      answer('topology', remote ? 'shared' : 'local');
      consoleValues(profile, values);
      loginValues(profile, values);
      if (consoles.length > 0) relevance = profile.login ? 'You have a console and a Linux login.' : 'You have a console to test against.';
      break;
    }
    case 'remote-board-access': {
      answer('access-level', profile.login ? 'shell' : 'console');
      answer('sharing', profile.sharing === 'team' ? 'pooled-users' : 'named-users');
      consoleValues(profile, values);
      loginValues(profile, values);
      if (remote) relevance = 'Your hardware sits on another host.';
      break;
    }
    case 'ci-integration': {
      setValue(values, 'ALLOCATED_PLACE', profile.names.place);
      if (remote && profile.sharing === 'team') relevance = 'Your board is shared, so CI jobs can reserve it.';
      break;
    }
    case 'board-farm-setup': {
      if (remote) relevance = 'You already run an exporter host.';
      break;
    }
    default:
      break;
  }

  return { useCaseId: definition.id, answers, values, relevance };
}

export function prefillAll(profile: BenchProfile, definitions: Iterable<UseCaseDefinition>, catalog: HardwareCatalog): Prefill[] {
  return [...definitions].map((definition) => prefillForUseCase(profile, definition, catalog));
}

export function applyPrefill(definition: UseCaseDefinition, answers: Record<string, string>): Answers {
  const engine = new DecisionEngine(definition);
  let current: Answers = {};
  for (const question of definition.questions) {
    const value = answers[question.id];
    if (value === undefined) continue;
    try {
      current = engine.setAnswer(current, question.id, value);
    } catch {
      // The answer is invalid or not visible on this path; leave the question for the user.
    }
  }
  return current;
}
