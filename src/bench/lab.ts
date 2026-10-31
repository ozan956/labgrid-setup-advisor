/**
 * A lab is several benches (one board each) that share an exporter host and
 * a coordinator. Each bench is projected to a v1 BenchProfile with
 * `benchProfile()`, so the per-bench generators, insights, checklists and
 * prefills keep working unchanged; the lab layer only adds the shared parts
 * and the operations the editor and the canvas need (add, duplicate, remove,
 * move a device between benches).
 *
 * Every operation is pure and returns a new lab.
 */

import { DEFAULT_COORDINATOR, emptyProfile } from './profile';
import { BENCH_PROFILE_VERSION, LAB_PROFILE_VERSION } from './types';
import type { BenchDevice, BenchProfile, Lab, LabBench } from './types';

export const MAX_BENCHES = 16;
const PLACE_BASE = 'board';

/* ------------------------------------------------------------------ */
/* Construction and projection                                         */
/* ------------------------------------------------------------------ */

export function benchFromProfile(profile: BenchProfile, id: string): LabBench {
  const bench: LabBench = {
    id,
    board: { ...profile.board },
    place: profile.names.place,
    group: profile.names.group,
    devices: structuredClone(profile.devices),
  };
  if (profile.login) bench.login = { ...profile.login };
  if (profile.bootloader) bench.bootloader = { ...profile.bootloader };
  return bench;
}

/** Wrap a single bench profile (v1) in a lab with one bench. */
export function labFromProfile(profile: BenchProfile): Lab {
  return {
    version: LAB_PROFILE_VERSION,
    name: '',
    topology: profile.topology,
    sharing: profile.sharing,
    names: {
      exporterHost: profile.names.exporterHost,
      coordinator: profile.names.coordinator,
      location: profile.names.location,
    },
    benches: [benchFromProfile(profile, 'bench-1')],
  };
}

export function emptyLab(): Lab {
  return labFromProfile(emptyProfile());
}

/** The v1 view of one bench: shared lab fields merged with the bench's own. */
export function benchProfile(lab: Lab, bench: LabBench): BenchProfile {
  const profile: BenchProfile = {
    version: BENCH_PROFILE_VERSION,
    board: { ...bench.board },
    topology: lab.topology,
    sharing: lab.sharing,
    names: {
      place: bench.place,
      group: bench.group,
      exporterHost: lab.names.exporterHost,
      coordinator: lab.names.coordinator,
      location: lab.names.location,
    },
    devices: bench.devices,
  };
  if (bench.login) profile.login = bench.login;
  if (bench.bootloader) profile.bootloader = bench.bootloader;
  return profile;
}

export function benchProfiles(lab: Lab): BenchProfile[] {
  return lab.benches.map((bench) => benchProfile(lab, bench));
}

export function findBench(lab: Lab, benchId: string): LabBench | undefined {
  return lab.benches.find((bench) => bench.id === benchId);
}

/** The bench that owns a device, if any. */
export function benchOfDevice(lab: Lab, deviceId: string): LabBench | undefined {
  return lab.benches.find((bench) => bench.devices.some((device) => device.id === deviceId));
}

/* ------------------------------------------------------------------ */
/* Names and ids                                                       */
/* ------------------------------------------------------------------ */

export function nextBenchId(lab: Lab): string {
  const taken = new Set(lab.benches.map(({ id }) => id));
  let n = lab.benches.length + 1;
  while (taken.has(`bench-${n}`)) n += 1;
  return `bench-${n}`;
}

/** The first free 'board-NN' place name, counting from 01. */
export function nextPlaceName(lab: Lab, base: string = PLACE_BASE): string {
  const taken = new Set(lab.benches.flatMap((bench) => [bench.place.trim(), bench.group.trim()]));
  let n = 1;
  while (taken.has(`${base}-${String(n).padStart(2, '0')}`)) n += 1;
  return `${base}-${String(n).padStart(2, '0')}`;
}

function nextDeviceIdIn(devices: BenchDevice[], preferred?: string): string {
  const taken = new Set(devices.map(({ id }) => id));
  if (preferred && !taken.has(preferred)) return preferred;
  let n = devices.length + 1;
  while (taken.has(`dev-${n}`)) n += 1;
  return `dev-${n}`;
}

/* ------------------------------------------------------------------ */
/* Bench operations                                                    */
/* ------------------------------------------------------------------ */

export function updateLab(lab: Lab, patch: Partial<Omit<Lab, 'version' | 'benches'>>): Lab {
  return { ...lab, ...patch, names: { ...lab.names, ...(patch.names ?? {}) } };
}

/** Add an empty bench; the place name is the next free 'board-NN'. */
export function addBench(lab: Lab, board: LabBench['board'] = { name: '' }): { lab: Lab; bench: LabBench } {
  if (lab.benches.length >= MAX_BENCHES) throw new RangeError(`a lab holds at most ${MAX_BENCHES} benches`);
  const place = nextPlaceName(lab);
  const bench: LabBench = { id: nextBenchId(lab), board: { ...board }, place, group: place, devices: [] };
  return { lab: { ...lab, benches: [...lab.benches, bench] }, bench };
}

function blankMatch(device: BenchDevice): BenchDevice {
  if (!('match' in device)) return device;
  const match = Object.fromEntries(Object.keys(device.match).map((key) => [key, '']));
  return { ...device, match };
}

/**
 * Copy a bench for a second unit of the same board. Device kinds, speeds,
 * PDU hosts and models are kept; udev match values are blanked because they
 * identify the first unit, and the place gets the next free name.
 */
export function duplicateBench(lab: Lab, benchId: string): { lab: Lab; bench: LabBench } {
  const source = findBench(lab, benchId);
  if (!source) throw new RangeError(`unknown bench "${benchId}"`);
  if (lab.benches.length >= MAX_BENCHES) throw new RangeError(`a lab holds at most ${MAX_BENCHES} benches`);
  const place = nextPlaceName(lab);
  const copy: LabBench = {
    ...structuredClone(source),
    id: nextBenchId(lab),
    place,
    group: source.group.trim() && source.group.trim() !== source.place.trim() ? `${source.group}-copy` : place,
    devices: structuredClone(source.devices).map(blankMatch),
  };
  const index = lab.benches.findIndex((bench) => bench.id === benchId);
  const benches = [...lab.benches.slice(0, index + 1), copy, ...lab.benches.slice(index + 1)];
  return { lab: { ...lab, benches }, bench: copy };
}

/** Remove a bench. Removing the last one leaves a fresh empty bench so the lab never has zero. */
export function removeBench(lab: Lab, benchId: string): Lab {
  const benches = lab.benches.filter((bench) => bench.id !== benchId);
  if (benches.length === lab.benches.length) return lab;
  if (benches.length === 0) {
    const fresh = benchFromProfile(emptyProfile(), 'bench-1');
    return { ...lab, benches: [fresh] };
  }
  return { ...lab, benches };
}

export function updateBench(lab: Lab, benchId: string, patch: Partial<Omit<LabBench, 'id'>>): Lab {
  return {
    ...lab,
    benches: lab.benches.map((bench) => {
      if (bench.id !== benchId) return bench;
      const next: LabBench = { ...bench, ...patch };
      if ('login' in patch && patch.login === undefined) delete next.login;
      if ('bootloader' in patch && patch.bootloader === undefined) delete next.bootloader;
      return next;
    }),
  };
}

/**
 * Apply a bench profile edited in the per-bench editor back to the lab: the
 * bench's own fields replace the bench, and the shared fields (topology,
 * sharing, exporter host, coordinator, location) update the lab.
 */
export function applyBenchProfile(lab: Lab, benchId: string, profile: BenchProfile): Lab {
  const shared = updateLab(lab, {
    topology: profile.topology,
    sharing: profile.sharing,
    names: {
      exporterHost: profile.names.exporterHost,
      coordinator: profile.names.coordinator,
      location: profile.names.location,
    },
  });
  const edited = benchFromProfile(profile, benchId);
  return {
    ...shared,
    benches: shared.benches.map((bench) => (bench.id === benchId ? edited : bench)),
  };
}

export function moveBench(lab: Lab, benchId: string, toIndex: number): Lab {
  const from = lab.benches.findIndex((bench) => bench.id === benchId);
  if (from === -1) return lab;
  const target = Math.max(0, Math.min(lab.benches.length - 1, toIndex));
  if (target === from) return lab;
  const benches = [...lab.benches];
  const [bench] = benches.splice(from, 1);
  benches.splice(target, 0, bench);
  return { ...lab, benches };
}

/* ------------------------------------------------------------------ */
/* Device operations                                                   */
/* ------------------------------------------------------------------ */

/** Add a device to a bench, renaming its id if the bench already uses it. */
export function addDevice(lab: Lab, benchId: string, device: BenchDevice, index?: number): Lab {
  const bench = findBench(lab, benchId);
  if (!bench) throw new RangeError(`unknown bench "${benchId}"`);
  const placed: BenchDevice = { ...device, id: nextDeviceIdIn(bench.devices, device.id) };
  const devices = [...bench.devices];
  devices.splice(index === undefined ? devices.length : Math.max(0, Math.min(devices.length, index)), 0, placed);
  return updateBench(lab, benchId, { devices });
}

export function removeDevice(lab: Lab, benchId: string, deviceId: string): Lab {
  const bench = findBench(lab, benchId);
  if (!bench) return lab;
  return updateBench(lab, benchId, { devices: bench.devices.filter((device) => device.id !== deviceId) });
}

/**
 * Move a device to another bench (or to another position in the same bench).
 * The device keeps its id unless the target bench already uses it.
 */
export function moveDevice(lab: Lab, deviceId: string, fromBenchId: string, toBenchId: string, index?: number): Lab {
  const from = findBench(lab, fromBenchId);
  const to = findBench(lab, toBenchId);
  if (!from || !to) return lab;
  const device = from.devices.find((item) => item.id === deviceId);
  if (!device) return lab;
  if (fromBenchId === toBenchId) {
    const without = from.devices.filter((item) => item.id !== deviceId);
    const position = index === undefined ? without.length : Math.max(0, Math.min(without.length, index));
    without.splice(position, 0, device);
    return updateBench(lab, fromBenchId, { devices: without });
  }
  const removed = removeDevice(lab, fromBenchId, deviceId);
  return addDevice(removed, toBenchId, device, index);
}

/* ------------------------------------------------------------------ */
/* Consistency                                                         */
/* ------------------------------------------------------------------ */

/** Structural problems the schema cannot express: duplicate ids and names. */
export function labErrors(lab: Lab): string[] {
  const errors: string[] = [];
  const benchIds = new Set<string>();
  const places = new Map<string, string>();
  const groups = new Map<string, string>();
  for (const bench of lab.benches) {
    if (benchIds.has(bench.id)) errors.push(`duplicate bench id "${bench.id}"`);
    benchIds.add(bench.id);
    const place = bench.place.trim();
    if (place) {
      const other = places.get(place);
      if (other && other !== bench.id) errors.push(`place "${place}" is used by two benches`);
      places.set(place, bench.id);
    }
    const group = bench.group.trim() || place;
    if (group) {
      const other = groups.get(group);
      if (other && other !== bench.id) errors.push(`exporter group "${group}" is used by two benches`);
      groups.set(group, bench.id);
    }
    const deviceIds = new Set<string>();
    for (const device of bench.devices) {
      if (deviceIds.has(device.id)) errors.push(`duplicate device id "${device.id}" in bench "${bench.id}"`);
      deviceIds.add(device.id);
    }
  }
  return errors;
}

export function labDeviceCount(lab: Lab): number {
  return lab.benches.reduce((sum, bench) => sum + bench.devices.length, 0);
}
