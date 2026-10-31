/**
 * Checklist for a lab: the steps that happen once per exporter host and
 * coordinator, then the steps of each bench, then the closing step.
 */

import { benchChecklistSteps, sharedChecklistSteps, verifyChecklistStep } from './checklist';
import { benchProfile } from './lab';
import { benchLabel } from './lab-insights';
import type { BenchProfile, GeneratedFile, HardwareCatalog, Lab, LabChecklistStep } from './types';

/**
 * A profile whose devices are the union of every bench, with the lab's shared
 * names, for the steps that cover the whole exporter host.
 */
export function unionProfile(lab: Lab): BenchProfile {
  const first = lab.benches[0];
  const base = benchProfile(lab, first);
  return {
    ...base,
    board: { name: lab.name.trim() || base.board.name },
    devices: lab.benches.flatMap((bench) => bench.devices),
  };
}

export function buildLabChecklist(lab: Lab, catalog: HardwareCatalog, files: GeneratedFile[]): LabChecklistStep[] {
  const shared = files.filter((file) => file.benchId === undefined);
  const envNameOverride = lab.benches.length > 1 ? 'each environment file' : undefined;
  const steps: LabChecklistStep[] = sharedChecklistSteps(unionProfile(lab), catalog, files, envNameOverride);

  for (const bench of lab.benches) {
    const own = files.filter((file) => file.benchId === bench.id);
    const label = benchLabel(bench);
    for (const step of benchChecklistSteps(benchProfile(lab, bench), own.length > 0 ? own : shared)) {
      steps.push({ ...step, id: `${step.id}:${bench.id}`, benchId: bench.id, benchLabel: label });
    }
  }

  steps.push(verifyChecklistStep());
  return steps;
}
