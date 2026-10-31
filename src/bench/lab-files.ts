/**
 * Files for a whole lab. Remote: one exporter.yaml with every bench's group,
 * one systemd drop-in, a client environment per bench, SETUP.md and the lab
 * profile. Local: an environment per bench plus SETUP.md and the profile.
 */

import { DEFAULT_COORDINATOR } from './profile';
import {
  clientEnvironmentFile,
  describeDevice,
  effectiveNames,
  exporterGroup,
  fileHeader,
  localEnvironmentFile,
  overrideConfFile,
  renderChecklist,
  toYaml,
  unresolvedTokens,
  type GenerateOptions,
} from './generate';
import { benchProfile } from './lab';
import { buildLabChecklist } from './lab-checklist';
import { benchLabel } from './lab-insights';
import type { GeneratedFile, HardwareCatalog, Lab, LabBench, LabChecklistStep } from './types';

export type { GenerateOptions } from './generate';

function labTitle(lab: Lab): string {
  return lab.name.trim() || (lab.benches.length === 1 ? benchLabel(lab.benches[0]) : `${lab.benches.length} benches`);
}

/** File name of a ZIP bundle for the lab, e.g. 'labgrid-rack-3.zip'. */
export function labZipName(lab: Lab): string {
  const slug = labTitle(lab).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'lab';
  return `labgrid-${slug}.zip`;
}

/** 'place' per bench, made unique when two benches share one (a lab error the insights report). */
function uniqueSuffixes(lab: Lab): Map<string, string> {
  const result = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const bench of lab.benches) {
    const place = effectiveNames(benchProfile(lab, bench)).place;
    const count = seen.get(place) ?? 0;
    seen.set(place, count + 1);
    result.set(bench.id, count === 0 ? place : `${place}-${bench.id}`);
  }
  return result;
}

function labExporterFile(lab: Lab, options: GenerateOptions): GeneratedFile {
  const groups: Record<string, unknown> = {};
  const used = new Set<string>();
  const subjects = [`Lab: ${labTitle(lab)} (${lab.benches.length} ${lab.benches.length === 1 ? 'bench' : 'benches'})`];
  for (const bench of lab.benches) {
    const { group, value } = exporterGroup(benchProfile(lab, bench));
    let key = group;
    let suffix = 2;
    while (used.has(key)) key = `${group}-${suffix++}`;
    used.add(key);
    groups[key] = value;
    subjects.push(`Group ${key}: ${benchLabel(bench)}`);
  }
  const purpose = `exporter resources for ${lab.benches.length === 1 ? 'one group' : `${lab.benches.length} groups`} on ${lab.names.exporterHost.trim() || 'the exporter host'}`;
  const content = fileHeader(subjects, purpose, options, 'exporter') + toYaml(groups);
  return {
    filename: 'exporter.yaml',
    kind: 'exporter',
    title: 'Exporter resources',
    description: lab.benches.length === 1
      ? 'Copy this file to the machine the hardware is plugged into and start labgrid-exporter with it. Each entry becomes a resource the coordinator can hand out.'
      : `Copy this file to the machine the hardware is plugged into and start labgrid-exporter with it. It holds one group per bench (${lab.benches.map((bench) => effectiveNames(benchProfile(lab, bench)).group).join(', ')}), so a single exporter serves every board.`,
    content,
    target: 'exporter-host',
    unresolved: unresolvedTokens(content),
  };
}

function benchSummaryRows(lab: Lab, bench: LabBench): string[] {
  const profile = benchProfile(lab, bench);
  const { place, group } = effectiveNames(profile);
  return [
    `### ${benchLabel(bench)}`,
    '',
    '| Item | Value |',
    '| --- | --- |',
    `| Board | ${bench.board.name.trim() || 'unnamed board'} |`,
    `| Place | ${place} |`,
    `| Exporter group | ${group} |`,
    ...(bench.login ? [`| Linux login | ${bench.login.username || '<USERNAME>'} |`] : []),
    ...(bench.bootloader ? [`| Bootloader | ${bench.bootloader.kind === 'uboot' ? 'U-Boot' : 'barebox'}, prompt ${JSON.stringify(bench.bootloader.prompt)} |`] : []),
    '',
    ...(bench.devices.length > 0 ? bench.devices.map((device) => `- ${device.label}: ${describeDevice(device)}`) : ['- no devices configured yet']),
    '',
  ];
}

function renderLabChecklist(lab: Lab, steps: LabChecklistStep[]): string {
  const sections: string[] = [];
  const shared = steps.filter((step) => step.benchId === undefined && step.id !== 'verify');
  const verify = steps.filter((step) => step.id === 'verify');
  sections.push(lab.benches.length > 1 ? '### Once for the lab\n\n' + renderChecklist(shared) : renderChecklist(shared));
  for (const bench of lab.benches) {
    const own = steps.filter((step) => step.benchId === bench.id);
    if (own.length === 0) continue;
    sections.push(lab.benches.length > 1 ? `### For ${benchLabel(bench)}\n\n` + renderChecklist(own) : renderChecklist(own));
  }
  if (verify.length > 0) sections.push(lab.benches.length > 1 ? '### Finally\n\n' + renderChecklist(verify) : renderChecklist(verify));
  return sections.join('\n\n');
}

function labSetupFile(lab: Lab, files: GeneratedFile[], steps: LabChecklistStep[]): GeneratedFile {
  const remote = lab.topology === 'remote';
  const coordinator = lab.names.coordinator.trim() || DEFAULT_COORDINATOR;
  const rows: Array<[string, string]> = [
    ...(lab.name.trim() ? [['Lab', lab.name.trim()] as [string, string]] : []),
    ['Benches', String(lab.benches.length)],
    ['Topology', remote ? 'remote (exporter + coordinator)' : 'local (this computer)'],
    ['Sharing', lab.sharing === 'team' ? 'several people or CI' : 'only me'],
    ...(remote ? [['Exporter host', lab.names.exporterHost.trim() || '<EXPORTER_HOST>'] as [string, string]] : []),
    ...(remote ? [['Coordinator', coordinator] as [string, string]] : []),
    ...(lab.names.location.trim() ? [['Location', lab.names.location.trim()] as [string, string]] : []),
  ];
  const unresolved = [...new Set(files.flatMap((file) => file.unresolved))];
  const lines = [
    `# Labgrid setup for ${labTitle(lab)}`,
    '',
    'Generated by Labgrid Setup Advisor. Review every value before use.',
    '',
    '## Lab summary',
    '',
    '| Item | Value |',
    '| --- | --- |',
    ...rows.map(([key, value]) => `| ${key} | ${value} |`),
    '',
    '## Benches',
    '',
    ...lab.benches.flatMap((bench) => benchSummaryRows(lab, bench)),
    '## Files in this bundle',
    '',
    ...files.map((file) => `- \`${file.filename}\` (${file.target}${file.benchId ? `, ${benchLabel(lab.benches.find((bench) => bench.id === file.benchId) ?? lab.benches[0])}` : ''}): ${file.description}`),
    '',
    ...(unresolved.length > 0
      ? ['## Placeholders to replace', '', ...unresolved.map((token) => `- \`<${token}>\``), '']
      : []),
    '## Step by step',
    '',
    renderLabChecklist(lab, steps),
    '',
  ];
  return {
    filename: 'SETUP.md',
    kind: 'notes',
    title: 'Setup notes',
    description: 'Human-readable summary of the lab and the ordered steps to bring every bench up.',
    content: lines.join('\n'),
    target: 'client',
    unresolved: [],
  };
}

function labProfileFile(lab: Lab): GeneratedFile {
  return {
    filename: 'lab-profile.json',
    kind: 'profile',
    title: 'Lab profile',
    description: 'Import this file into the advisor later to continue editing the same lab.',
    content: `${JSON.stringify(lab, null, 2)}\n`,
    target: 'client',
    unresolved: [],
  };
}

/**
 * Every file a lab needs. Shared files have no `benchId`; the environment
 * file of each bench carries its bench id so the UI can group them.
 */
export function generateLabFiles(lab: Lab, catalog: HardwareCatalog, options: GenerateOptions = {}): GeneratedFile[] {
  // A lab with one bench keeps the plain file names the guides and docs use.
  const single = lab.benches.length === 1;
  const files: GeneratedFile[] = [];
  const suffixes = uniqueSuffixes(lab);
  const coordinator = lab.names.coordinator.trim() || DEFAULT_COORDINATOR;

  if (lab.topology === 'remote') {
    files.push(labExporterFile(lab, options));
    if (coordinator !== DEFAULT_COORDINATOR) files.push(overrideConfFile(coordinator));
    for (const bench of lab.benches) {
      const file = clientEnvironmentFile(benchProfile(lab, bench), options, single ? 'remote.yaml' : `remote-${suffixes.get(bench.id)}.yaml`);
      files.push({ ...file, title: `Client environment: ${benchLabel(bench)}`, benchId: bench.id });
    }
  } else {
    for (const bench of lab.benches) {
      const file = localEnvironmentFile(benchProfile(lab, bench), options, single ? 'environment.yaml' : `environment-${suffixes.get(bench.id)}.yaml`);
      files.push({ ...file, title: `Local environment: ${benchLabel(bench)}`, benchId: bench.id });
    }
  }

  const steps = buildLabChecklist(lab, catalog, files);
  return [...files, labSetupFile(lab, files, steps), labProfileFile(lab)];
}

/** Files of one bench plus the shared ones, in bundle order. */
export function filesForBench(files: GeneratedFile[], benchId: string): GeneratedFile[] {
  return files.filter((file) => file.benchId === undefined || file.benchId === benchId);
}
