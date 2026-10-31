import { describe, expect, it } from 'vitest';
import { hardwareCatalog } from '../src/bench/catalog';
import { addBench, addDevice, emptyLab, labFromProfile, updateBench } from '../src/bench/lab';
import { analyzeLab, insightsForBench } from '../src/bench/lab-insights';
import { sampleLabs } from '../src/bench/lab-samples';
import { sampleBenches } from '../src/bench/samples';
import type { BenchDevice, Lab } from '../src/bench/types';

function sample(id: string): Lab {
  const found = sampleLabs.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing sample lab ${id}`);
  return structuredClone(found.lab);
}

const ids = (lab: Lab): string[] => analyzeLab(lab, hardwareCatalog).map((insight) => insight.id);
const byId = (lab: Lab, id: string) => analyzeLab(lab, hardwareCatalog).find((insight) => insight.id === id || insight.id.startsWith(`${id}:`));

describe('lab insights composition', () => {
  it('tags bench insights with the bench and reports shared ones once', () => {
    const lab = sample('rack-remote');
    const insights = analyzeLab(lab, hardwareCatalog);
    const teamSharing = insights.filter((insight) => insight.id === 'team-sharing');
    expect(teamSharing).toHaveLength(1);
    expect(teamSharing[0].benchId).toBeUndefined();
    expect(insights.filter((insight) => insight.id === 'ykush-tools')).toHaveLength(1);
    expect(insights.filter((insight) => insight.id === 'ready')).toHaveLength(0);
    const consoleHints = insights.filter((insight) => insight.id === 'board-console-hint');
    expect(consoleHints.map((insight) => insight.benchId)).toEqual(['bench-1', 'bench-2', 'bench-3']);
    expect(consoleHints[1].benchLabel).toBe('NXP i.MX 8M Mini EVK');
    expect(insightsForBench(insights, 'bench-3').every((insight) => insight.benchId === 'bench-3')).toBe(true);
    expect(insightsForBench(insights, undefined).some((insight) => insight.id === 'team-sharing')).toBe(true);
  });

  it('merges strategy-ready into one lab-level insight naming the benches', () => {
    const insights = analyzeLab(sample('desk-local'), hardwareCatalog);
    const strategies = insights.filter((insight) => insight.id === 'strategy-ready');
    expect(strategies).toHaveLength(1);
    expect(strategies[0].title).toBe('Boot strategies will be generated');
    expect(strategies[0].detail).toContain('AMD Xilinx ZCU102, BeaglePlay');
  });

  it('reports lab-ready for complete labs and the shared PDU as information', () => {
    const lab = sample('rack-remote');
    const insights = analyzeLab(lab, hardwareCatalog);
    expect(insights.some((insight) => insight.severity === 'critical')).toBe(false);
    const ready = insights.find((insight) => insight.id === 'lab-ready');
    expect(ready?.title).toBe('All 3 benches are described');
    expect(insights.at(-1)?.severity).toBe('success');
    const pdu = byId(lab, 'lab-shared-pdu');
    expect(pdu?.severity).toBe('info');
    expect(pdu?.detail).toContain('outlet 1 powers Raspberry Pi 4 Model B');
    expect(pdu?.detail).toContain('outlet 2 powers NXP i.MX 8M Mini EVK');
    expect(pdu?.devices).toEqual(['dev-2', 'dev-2']);
  });

  it('uses the single-bench wording for a one-bench lab', () => {
    const lab = labFromProfile(sampleBenches[0].profile);
    expect(byId(lab, 'lab-ready')?.title).toBe('Your bench description is complete');
    expect(ids(lab)).not.toContain('lab-shared-pdu');
  });
});

describe('cross-bench rules', () => {
  it('flags the same udev match on two benches as one device claimed twice', () => {
    const lab = sample('rack-remote');
    const stolen: BenchDevice = { id: 'dev-9', kind: 'usb-serial', label: 'Second console', match: { ID_PATH: 'pci-0000:00:14.0-usb-0:1.1:1.0' }, speed: 115200 };
    const clash = addDevice(lab, 'bench-3', stolen);
    const insight = byId(clash, 'lab-shared-match');
    expect(insight?.severity).toBe('critical');
    expect(insight?.title).toContain('ID_PATH pci-0000:00:14.0-usb-0:1.1:1.0');
    expect(insight?.detail).toContain('"Console" on Raspberry Pi 4 Model B and "Second console" on STM32 Nucleo-64');
    expect(insight?.devices).toEqual(['dev-1', 'dev-9']);
    expect(ids(clash)).not.toContain('lab-ready');
    // The same serial inside one bench (ST-LINK console + probe) is not a conflict.
    expect(ids(lab).filter((id) => id.startsWith('lab-shared-match'))).toEqual([]);
  });

  it('ignores @-prefixed key spelling differences and blank values', () => {
    const lab = sample('rack-remote');
    const clash = addDevice(lab, 'bench-1', { id: 'dev-9', kind: 'usb-debugger', label: 'Probe', match: { '@ID_SERIAL_SHORT': '066BFF3435504B3043061724' } });
    expect(ids(clash).some((id) => id.startsWith('lab-shared-match:ID_SERIAL_SHORT='))).toBe(true);
    const blank = addDevice(lab, 'bench-1', { id: 'dev-9', kind: 'usb-debugger', label: 'Probe', match: { ID_SERIAL_SHORT: '' } });
    expect(ids(blank).some((id) => id.startsWith('lab-shared-match'))).toBe(false);
  });

  it('lets the channels of one multi-interface converter serve different benches', () => {
    const lab = sample('rack-remote');
    // The i.MX bench already uses the FT4232H channel 02; channel 01 of the same chip feeds the Pi.
    const channel: BenchDevice = { id: 'dev-9', kind: 'usb-serial', label: 'Second channel', match: { ID_SERIAL_SHORT: 'FT6RQ2PA', ID_USB_INTERFACE_NUM: '01' }, speed: 115200 };
    expect(ids(addDevice(lab, 'bench-1', channel)).some((id) => id.startsWith('lab-shared-match'))).toBe(false);
    const sameChannel = addDevice(lab, 'bench-1', { ...channel, match: { ID_SERIAL_SHORT: 'FT6RQ2PA', ID_USB_INTERFACE_NUM: '02' } });
    const insight = byId(sameChannel, 'lab-shared-match');
    expect(insight?.id).toBe('lab-shared-match:ID_SERIAL_SHORT=FT6RQ2PA@02');
    expect(insight?.title).toContain('ID_SERIAL_SHORT FT6RQ2PA interface 02');
  });

  it('flags the same PDU outlet, YKUSH port and hub port on two benches', () => {
    const lab = sample('rack-remote');
    const sameOutlet = updateBench(lab, 'bench-2', {
      devices: lab.benches[1].devices.map((device) => (device.kind === 'network-pdu' ? { ...device, index: 1 } : device)),
    });
    const outlet = byId(sameOutlet, 'lab-shared-outlet');
    expect(outlet?.severity).toBe('critical');
    expect(outlet?.detail).toContain('outlet 1 of PDU netio-rack3.lab.example.org');
    expect(ids(sameOutlet)).not.toContain('lab-shared-pdu:netio-rack3.lab.example.org');

    const sameYkush = addDevice(lab, 'bench-1', { id: 'dev-9', kind: 'ykush', label: 'YKUSH', serial: 'Y3N00321', index: '1' });
    expect(byId(sameYkush, 'lab-shared-outlet')?.detail).toContain('port 1 of YKUSH Y3N00321');

    const desk = sample('desk-local');
    const sameHub = addDevice(desk, 'bench-2', { id: 'dev-9', kind: 'usb-hub-port', label: 'Hub port', match: { ID_PATH: 'pci-0000:00:14.0-usb-0:3:1.0' }, index: 1 });
    expect(byId(sameHub, 'lab-shared-outlet')?.detail).toContain('port 1 of the hub at pci-0000:00:14.0-usb-0:3:1.0');
    expect(ids(sameHub).some((id) => id.startsWith('lab-shared-match'))).toBe(false);
  });

  it('describes a hub shared with distinct ports as information', () => {
    const desk = sample('desk-local');
    const sharedHub = addDevice(desk, 'bench-2', { id: 'dev-9', kind: 'usb-hub-port', label: 'Hub port 2', match: { ID_PATH: 'pci-0000:00:14.0-usb-0:3:1.0' }, index: 2 });
    const hub = byId(sharedHub, 'lab-shared-hub');
    expect(hub?.severity).toBe('info');
    expect(hub?.detail).toContain('port 1 powers AMD Xilinx ZCU102, port 2 powers BeaglePlay');
    expect(ids(sharedHub).some((id) => id.startsWith('lab-shared-outlet'))).toBe(false);
  });

  it('reports duplicate place names once at lab level', () => {
    const lab = updateBench(sample('rack-remote'), 'bench-2', { place: 'pi4-01', group: 'pi4-01' });
    const insight = byId(lab, 'lab-duplicate-place');
    expect(insight?.severity).toBe('critical');
    expect(insight?.benchId).toBeUndefined();
    expect(insight?.detail).toContain('place "pi4-01" is used by two benches');
    expect(analyzeLab(lab, hardwareCatalog)[0].id).toBe('lab-duplicate-place');
  });

  it('warns about an empty bench and never calls an empty lab ready', () => {
    const lab = addBench(sample('rack-remote'), { name: 'Spare board' }).lab;
    const empty = analyzeLab(lab, hardwareCatalog).find((insight) => insight.id === 'lab-empty-bench');
    expect(empty?.severity).toBe('warning');
    expect(empty?.benchId).toBe('bench-4');
    expect(empty?.title).toBe('Spare board has no devices yet');
    expect(ids(lab)).toContain('lab-ready');
    expect(ids(emptyLab())).toContain('lab-empty-bench');
    expect(ids(emptyLab())).not.toContain('lab-ready');
  });

  it('suggests a second exporter host beyond eight benches', () => {
    let lab = sample('rack-remote');
    expect(ids(lab)).not.toContain('lab-many-benches');
    for (let n = 0; n < 6; n += 1) lab = addBench(lab, { name: `Board ${n}` }).lab;
    expect(lab.benches).toHaveLength(9);
    expect(byId(lab, 'lab-many-benches')?.detail).toContain('second exporter host');
  });

  it('sorts by severity with critical first', () => {
    const lab = updateBench(sample('rack-remote'), 'bench-2', { place: 'pi4-01', group: 'pi4-01' });
    const severities = analyzeLab(lab, hardwareCatalog).map((insight) => insight.severity);
    const order = { critical: 0, warning: 1, info: 2, success: 3 };
    for (let index = 1; index < severities.length; index += 1) {
      expect(order[severities[index]]).toBeGreaterThanOrEqual(order[severities[index - 1]]);
    }
  });
});
