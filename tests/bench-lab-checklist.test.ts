import { describe, expect, it } from 'vitest';
import { hardwareCatalog } from '../src/bench/catalog';
import { buildChecklist } from '../src/bench/checklist';
import { generateBenchFiles } from '../src/bench/generate';
import { labFromProfile, updateBench } from '../src/bench/lab';
import { buildLabChecklist, unionProfile } from '../src/bench/lab-checklist';
import { generateLabFiles } from '../src/bench/lab-files';
import { sampleLabs } from '../src/bench/lab-samples';
import { sampleBenches } from '../src/bench/samples';
import type { Lab } from '../src/bench/types';

function sample(id: string): Lab {
  const found = sampleLabs.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing sample lab ${id}`);
  return structuredClone(found.lab);
}

describe('lab checklist', () => {
  const lab = sample('rack-remote');
  const files = generateLabFiles(lab, hardwareCatalog);
  const steps = buildLabChecklist(lab, hardwareCatalog, files);

  it('runs the shared steps once, then every bench, then verify', () => {
    const shared = steps.filter((step) => step.benchId === undefined).map((step) => step.id);
    expect(shared).toEqual(['install-labgrid', 'install-tools', 'device-access', 'start-coordinator', 'start-exporter', 'check-resources', 'verify']);
    expect(steps.at(-1)?.id).toBe('verify');
    const perBench = steps.filter((step) => step.benchId !== undefined);
    expect(perBench.map((step) => step.id)).toEqual([
      'create-place:bench-1', 'acquire:bench-1', 'share:bench-1', 'run-tests:bench-1',
      'create-place:bench-2', 'acquire:bench-2', 'share:bench-2', 'run-tests:bench-2',
      'create-place:bench-3', 'acquire:bench-3', 'share:bench-3', 'run-tests:bench-3',
    ]);
    expect(new Set(steps.map((step) => step.id)).size).toBe(steps.length);
    expect(perBench[4].benchLabel).toBe('NXP i.MX 8M Mini EVK');
  });

  it('unions the helper tools of every bench into the shared step', () => {
    const tools = steps.find((step) => step.id === 'install-tools');
    expect(tools?.commands).toEqual(expect.arrayContaining([
      expect.stringContaining('ykushcmd'),
      expect.stringContaining('imx-usb-loader'),
      'sudo apt install openocd',
      'sudo apt install ser2net',
    ]));
    expect(tools?.detail).toContain('each environment file');
    const exporter = steps.find((step) => step.id === 'start-exporter');
    expect(exporter?.commands).toEqual(['LG_COORDINATOR=coordinator.lab:20408 labgrid-exporter -n rack3-pc exporter.yaml']);
  });

  it('uses each bench\'s own place and environment file in its steps', () => {
    const create = steps.find((step) => step.id === 'create-place:bench-2');
    expect(create?.commands).toEqual([
      'labgrid-client -x coordinator.lab:20408 -p imx8mm-01 create',
      'labgrid-client -x coordinator.lab:20408 -p imx8mm-01 add-match rack3-pc/imx8mm-01/*',
    ]);
    const run = steps.find((step) => step.id === 'run-tests:bench-3');
    expect(run?.commands).toContain('pytest --lg-env remote-nucleo-01.yaml -v');
    const share = steps.find((step) => step.id === 'share:bench-1');
    expect(share?.commands?.[0]).toBe('labgrid-client -x coordinator.lab:20408 -p pi4-01 set-tags board=raspberry-pi-4-model-b');
  });

  it('collects placeholders from every bench into one shared step', () => {
    const blank = updateBench(lab, 'bench-3', {
      devices: [{ id: 'dev-1', kind: 'usb-serial', label: 'Console', match: { ID_SERIAL_SHORT: '' }, speed: 115200 }],
    });
    const blankFiles = generateLabFiles(blank, hardwareCatalog);
    const blankSteps = buildLabChecklist(blank, hardwareCatalog, blankFiles);
    const fill = blankSteps.filter((step) => step.id === 'fill-placeholders');
    expect(fill).toHaveLength(1);
    expect(fill[0].benchId).toBeUndefined();
    expect(fill[0].title).toBe('Replace 1 placeholder value in the generated files');
  });

  it('produces local steps per bench for a local lab', () => {
    const desk = sample('desk-local');
    const deskSteps = buildLabChecklist(desk, hardwareCatalog, generateLabFiles(desk, hardwareCatalog));
    expect(deskSteps.filter((step) => step.benchId === undefined).map((step) => step.id)).toEqual(['install-labgrid', 'install-tools', 'device-access', 'verify']);
    expect(deskSteps.find((step) => step.id === 'try-environment:bench-2')?.commands?.[0]).toContain("Environment('environment-beagleplay-01.yaml')");
    expect(deskSteps.find((step) => step.id === 'run-tests:bench-1')?.commands).toEqual(['pytest --lg-env environment-zcu102-01.yaml -v']);
    expect(deskSteps.find((step) => step.id === 'install-tools')?.commands).toEqual(['sudo apt install uhubctl']);
  });

  it('matches the bench checklist for a single-bench lab apart from the id suffix', () => {
    for (const sampleBench of sampleBenches) {
      const single = labFromProfile(sampleBench.profile);
      const labSteps = buildLabChecklist(single, hardwareCatalog, generateLabFiles(single, hardwareCatalog));
      const benchSteps = buildChecklist(sampleBench.profile, hardwareCatalog, generateBenchFiles(sampleBench.profile, hardwareCatalog));
      // Lab environment files carry the place in their name; everything else must match.
      const place = sampleBench.profile.names.place;
      const normalize = (text: string | undefined): string | undefined => text?.replace(new RegExp(`(remote|environment)-${place}\\.yaml`, 'g'), '$1.yaml');
      expect(labSteps.map((step) => step.id.replace(':bench-1', ''))).toEqual(benchSteps.map((step) => step.id));
      expect(labSteps.map((step) => step.commands?.map(normalize))).toEqual(benchSteps.map((step) => step.commands));
      expect(labSteps.map((step) => normalize(step.detail))).toEqual(benchSteps.map((step) => step.detail));
      expect(labSteps.map((step) => normalize(step.title))).toEqual(benchSteps.map((step) => step.title));
    }
  });

  it('builds a union profile with every device and the lab name', () => {
    const union = unionProfile(lab);
    expect(union.devices).toHaveLength(8);
    expect(union.board.name).toBe('Rack 3');
    expect(union.names.exporterHost).toBe('rack3-pc');
    expect(union.topology).toBe('remote');
  });
});
