/**
 * Insights for a whole lab: every bench's own insights, tagged with the
 * bench, plus rules that only make sense across benches (one physical
 * device or outlet claimed twice, duplicate place names, an empty bench).
 * Insights about shared settings (exporter host, coordinator, team mode,
 * YKUSH tooling) are reported once for the lab rather than once per bench.
 */

import { analyzeProfile } from './insights';
import { benchProfile, labErrors } from './lab';
import type { BenchDevice, HardwareCatalog, Insight, InsightSeverity, Lab, LabBench, LabInsight } from './types';

const SEVERITY_ORDER: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2, success: 3 };

/** Insight ids that describe the lab's shared settings, kept once. */
const SHARED_IDS = new Set(['remote-exporter-name', 'remote-coordinator-address', 'remote-exporter-tools', 'team-sharing', 'ykush-tools', 'strategy-ready']);
/** Per-bench completeness is replaced by the lab-level verdict. */
const DROPPED_IDS = new Set(['ready']);

const DOCS = {
  exporter: { title: 'labgrid-exporter', url: 'https://labgrid.readthedocs.io/en/latest/man/exporter.html' },
  udev: { title: 'udev matching', url: 'https://labgrid.readthedocs.io/en/latest/configuration.html#udev-matching' },
  usbPowerPort: { title: 'USBPowerPort', url: 'https://labgrid.readthedocs.io/en/latest/configuration.html#usbpowerport' },
  networkPowerPort: { title: 'NetworkPowerPort', url: 'https://labgrid.readthedocs.io/en/latest/configuration.html#networkpowerport' },
  places: { title: 'Places and reservations', url: 'https://labgrid.readthedocs.io/en/latest/usage.html' },
};

export function benchLabel(bench: LabBench): string {
  return bench.board.name.trim() || bench.place.trim() || bench.id;
}

interface Claim {
  bench: LabBench;
  device: BenchDevice;
}

function groupClaims(claims: Map<string, Claim[]>, key: string, claim: Claim): void {
  claims.set(key, [...(claims.get(key) ?? []), claim]);
}

/** Claims spread over at least two different benches. */
function crossBench(claims: Claim[]): boolean {
  return new Set(claims.map((claim) => claim.bench.id)).size > 1;
}

function describeClaims(claims: Claim[]): string {
  return claims.map((claim) => `"${claim.device.label}" on ${benchLabel(claim.bench)}`).join(' and ');
}

function sharedMatchInsights(lab: Lab): LabInsight[] {
  const claims = new Map<string, Claim[]>();
  for (const bench of lab.benches) {
    for (const device of bench.devices) {
      // Hub ports legitimately share the hub's ID_PATH; their outlets are checked separately.
      if (!('match' in device) || device.kind === 'usb-hub-port') continue;
      // A multi-interface converter (FT4232H, CP2108) is one USB device whose
      // channels may legitimately serve different boards, so the interface
      // number is part of the identity when it is given.
      const iface = Object.entries(device.match).find(([key]) => key.replace(/^@/, '').trim() === 'ID_USB_INTERFACE_NUM')?.[1]?.trim();
      for (const [rawKey, rawValue] of Object.entries(device.match)) {
        const key = rawKey.replace(/^@/, '').trim();
        const value = rawValue.trim();
        if (!key || !value || key === 'ID_USB_INTERFACE_NUM') continue;
        groupClaims(claims, `${key}=${value}${iface ? ` interface ${iface}` : ''}`, { bench, device });
      }
    }
  }
  const insights: LabInsight[] = [];
  for (const [key, list] of claims) {
    if (!crossBench(list)) continue;
    const [name, value] = key.split('=');
    insights.push({
      id: `lab-shared-match:${key.replace(' interface ', '@')}`,
      severity: 'critical',
      title: `One USB device is claimed by two benches (${name} ${value})`,
      detail: `${describeClaims(list)} use the same udev match, so they are the same physical device. An exporter can offer a device in one group only; move the device to the bench it really belongs to, or fix the match value of the other one.`,
      devices: list.map((claim) => claim.device.id),
      docs: [DOCS.udev, DOCS.exporter],
    });
  }
  return insights;
}

function outletInsights(lab: Lab): LabInsight[] {
  const outlets = new Map<string, Claim[]>();
  const pduHosts = new Map<string, Claim[]>();
  const hubs = new Map<string, Claim[]>();
  for (const bench of lab.benches) {
    for (const device of bench.devices) {
      const claim = { bench, device };
      switch (device.kind) {
        case 'network-pdu': {
          const host = device.host.trim();
          if (!host) break;
          groupClaims(outlets, `pdu:${host}:${device.index}`, claim);
          groupClaims(pduHosts, host, claim);
          break;
        }
        case 'ykush': {
          const serial = device.serial.trim();
          if (serial) groupClaims(outlets, `ykush:${serial}:${device.index}`, claim);
          break;
        }
        case 'usb-hub-port': {
          const path = Object.entries(device.match).find(([key, value]) => key.replace(/^@/, '') === 'ID_PATH' && value.trim())?.[1]?.trim();
          if (!path) break;
          groupClaims(outlets, `hub:${path}:${device.index}`, claim);
          groupClaims(hubs, path, claim);
          break;
        }
        default:
          break;
      }
    }
  }

  const insights: LabInsight[] = [];
  for (const [key, list] of outlets) {
    if (!crossBench(list)) continue;
    const [kind, ...rest] = key.split(':');
    const index = rest.pop();
    const where = rest.join(':');
    const noun = kind === 'pdu' ? `outlet ${index} of PDU ${where}` : kind === 'ykush' ? `port ${index} of YKUSH ${where}` : `port ${index} of the hub at ${where}`;
    insights.push({
      id: `lab-shared-outlet:${key}`,
      severity: 'critical',
      title: `Two benches switch the same power outlet`,
      detail: `${describeClaims(list)} both point at ${noun}. Power-cycling one board would also cut the other. Give each board its own outlet or port, and fix the index here.`,
      devices: list.map((claim) => claim.device.id),
      docs: [kind === 'pdu' ? DOCS.networkPowerPort : DOCS.usbPowerPort],
    });
  }
  for (const [host, list] of pduHosts) {
    if (!crossBench(list)) continue;
    const indices = new Set(list.map((claim) => (claim.device.kind === 'network-pdu' ? claim.device.index : undefined)));
    if (indices.size < 2) continue;
    insights.push({
      id: `lab-shared-pdu:${host}`,
      severity: 'info',
      title: `PDU ${host} serves several benches`,
      detail: `${list.map((claim) => `outlet ${claim.device.kind === 'network-pdu' ? claim.device.index : '?'} powers ${benchLabel(claim.bench)}`).join(', ')}. That is fine: each outlet becomes its own NetworkPowerPort. Keep the outlet numbers in step with the labels on the PDU.`,
      devices: list.map((claim) => claim.device.id),
      docs: [DOCS.networkPowerPort],
    });
  }
  for (const [path, list] of hubs) {
    if (!crossBench(list)) continue;
    const indices = new Set(list.map((claim) => (claim.device.kind === 'usb-hub-port' ? claim.device.index : undefined)));
    if (indices.size < 2) continue;
    insights.push({
      id: `lab-shared-hub:${path}`,
      severity: 'info',
      title: 'Several benches hang off the same USB hub',
      detail: `${list.map((claim) => `port ${claim.device.kind === 'usb-hub-port' ? claim.device.index : '?'} powers ${benchLabel(claim.bench)}`).join(', ')} (hub ${path}). The boards share the hub's upstream bandwidth and its power budget, so check the hub's per-port current against what each board draws.`,
      devices: list.map((claim) => claim.device.id),
      docs: [DOCS.usbPowerPort],
    });
  }
  return insights;
}

/**
 * Insights for every bench plus cross-bench checks. Bench-specific insights
 * keep their ids and carry `benchId` and `benchLabel`; shared ones appear once.
 */
export function analyzeLab(lab: Lab, catalog: HardwareCatalog): LabInsight[] {
  const insights: LabInsight[] = [];
  const seenShared = new Set<string>();
  const strategyBenches: string[] = [];

  for (const bench of lab.benches) {
    const label = benchLabel(bench);
    for (const insight of analyzeProfile(benchProfile(lab, bench), catalog)) {
      if (DROPPED_IDS.has(insight.id)) continue;
      if (SHARED_IDS.has(insight.id)) {
        if (insight.id === 'strategy-ready') strategyBenches.push(label);
        if (seenShared.has(insight.id)) continue;
        seenShared.add(insight.id);
        insights.push({ ...insight });
        continue;
      }
      insights.push({ ...insight, benchId: bench.id, benchLabel: label });
    }
    if (bench.devices.length === 0) {
      insights.push({
        id: 'lab-empty-bench',
        severity: 'warning',
        title: `${label} has no devices yet`,
        detail: 'A bench without a console or power control produces an empty exporter group and nothing for tests to use. Add the devices that connect this board, or remove the bench.',
        benchId: bench.id,
        benchLabel: label,
      });
    }
  }

  // Several benches may get a strategy; say which ones in the single shared insight.
  if (strategyBenches.length > 1) {
    const shared = insights.find((insight) => insight.id === 'strategy-ready');
    if (shared) {
      shared.title = 'Boot strategies will be generated';
      shared.detail = `Power, console and login are known for ${strategyBenches.join(', ')}, so each of their environment files gets a strategy. Tests can ask for the "shell" state and Labgrid boots the board for them.`;
    }
  }

  const nameErrors = labErrors(lab).filter((error) => error.includes('is used by two benches'));
  if (nameErrors.length > 0) {
    insights.push({
      id: 'lab-duplicate-place',
      severity: 'critical',
      title: 'Two benches share a place or group name',
      detail: `${nameErrors.join('; ')}. Places and exporter groups must be unique: the coordinator keys places by name, and two groups with one name would merge in exporter.yaml. Rename one of them.`,
      docs: [DOCS.places],
    });
  }

  insights.push(...sharedMatchInsights(lab));
  insights.push(...outletInsights(lab));

  if (lab.benches.length > 8) {
    insights.push({
      id: 'lab-many-benches',
      severity: 'info',
      title: `${lab.benches.length} benches on one exporter host`,
      detail: 'One exporter can serve many boards, but USB bandwidth, power and the blast radius of a host reboot grow with every bench. Consider a second exporter host once a rack passes eight boards; the coordinator can handle any number of exporters.',
      docs: [DOCS.exporter],
    });
  }

  const hasCritical = insights.some((insight) => insight.severity === 'critical');
  const hasDevices = lab.benches.some((bench) => bench.devices.length > 0);
  if (!hasCritical && hasDevices) {
    insights.push({
      id: 'lab-ready',
      severity: 'success',
      title: lab.benches.length === 1 ? 'Your bench description is complete' : `All ${lab.benches.length} benches are described`,
      detail: 'Every device has the values Labgrid needs and no device or outlet is claimed twice. Download the generated files and follow the checklist.',
    });
  }

  return insights.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Convenience for the UI: insights of one bench, or the shared ones when benchId is undefined. */
export function insightsForBench(insights: LabInsight[], benchId: string | undefined): LabInsight[] {
  return insights.filter((insight) => insight.benchId === benchId);
}

export type { Insight };
