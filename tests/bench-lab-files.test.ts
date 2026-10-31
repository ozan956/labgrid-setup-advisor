import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { hardwareCatalog } from '../src/bench/catalog';
import { addBench, labFromProfile, updateBench, updateLab } from '../src/bench/lab';
import { filesForBench, generateLabFiles, labZipName } from '../src/bench/lab-files';
import { sampleLabs } from '../src/bench/lab-samples';
import { generateBenchFiles } from '../src/bench/generate';
import { sampleBenches } from '../src/bench/samples';
import { validateLab } from '../src/bench/storage';
import type { Lab } from '../src/bench/types';

function sample(id: string): Lab {
  const found = sampleLabs.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing sample lab ${id}`);
  return structuredClone(found.lab);
}

describe('lab file generation (remote)', () => {
  const lab = sample('rack-remote');
  const files = generateLabFiles(lab, hardwareCatalog);

  it('produces one exporter file with every group and only ## comments', () => {
    const exporters = files.filter((file) => file.kind === 'exporter');
    expect(exporters).toHaveLength(1);
    const [exporter] = exporters;
    expect(exporter.filename).toBe('exporter.yaml');
    expect(exporter.benchId).toBeUndefined();
    expect(exporter.unresolved).toEqual([]);
    const parsed = parse(exporter.content) as Record<string, Record<string, unknown>>;
    expect(Object.keys(parsed)).toEqual(['pi4-01', 'imx8mm-01', 'nucleo-01']);
    expect(parsed['pi4-01'].location).toBe('Rack 3');
    expect(parsed['nucleo-01']).toHaveProperty('YKUSHPowerPort');
    expect(parsed['imx8mm-01']).toHaveProperty('IMXUSBLoader');
    for (const line of exporter.content.split('\n')) {
      if (line.startsWith('#')) expect(line.startsWith('##')).toBe(true);
    }
    expect(exporter.content).toContain('## Lab: Rack 3 (3 benches)');
    expect(exporter.content).toContain('## Group imx8mm-01: NXP i.MX 8M Mini EVK');
    expect(exporter.description).toContain('pi4-01, imx8mm-01, nucleo-01');
  });

  it('names one client environment per bench and tags it with the bench id', () => {
    const environments = files.filter((file) => file.kind === 'environment');
    expect(environments.map((file) => file.filename)).toEqual(['remote-pi4-01.yaml', 'remote-imx8mm-01.yaml', 'remote-nucleo-01.yaml']);
    expect(environments.map((file) => file.benchId)).toEqual(['bench-1', 'bench-2', 'bench-3']);
    expect(environments[1].title).toBe('Client environment: NXP i.MX 8M Mini EVK');
    const parsed = parse(environments[1].content) as { targets: { main: { resources: { RemotePlace: { name: string } }; drivers: unknown } } };
    expect(parsed.targets.main.resources.RemotePlace.name).toBe('imx8mm-01');
    expect(JSON.stringify(parsed.targets.main.drivers)).toContain('UBootStrategy');
  });

  it('adds the systemd drop-in for a non-default coordinator, once', () => {
    const services = files.filter((file) => file.kind === 'service');
    expect(services).toHaveLength(1);
    expect(services[0].content).toContain('LG_COORDINATOR=coordinator.lab:20408');
    expect(services[0].benchId).toBeUndefined();
  });

  it('writes a SETUP.md with a lab summary, a section per bench, and grouped steps', () => {
    const notes = files.find((file) => file.kind === 'notes');
    expect(notes?.filename).toBe('SETUP.md');
    expect(notes?.content).toContain('# Labgrid setup for Rack 3');
    expect(notes?.content).toContain('| Benches | 3 |');
    expect(notes?.content).toContain('| Exporter host | rack3-pc |');
    expect(notes?.content).toContain('### Raspberry Pi 4 Model B');
    expect(notes?.content).toContain('### STM32 Nucleo-64');
    expect(notes?.content).toContain('### Once for the lab');
    expect(notes?.content).toContain('### For NXP i.MX 8M Mini EVK');
    expect(notes?.content).toContain('### Finally');
    expect(notes?.content).toContain('`remote-nucleo-01.yaml` (client, STM32 Nucleo-64)');
    expect(notes?.content).not.toContain('## Placeholders to replace');
  });

  it('includes the lab profile as JSON', () => {
    const profile = files.find((file) => file.kind === 'profile');
    expect(profile?.filename).toBe('lab-profile.json');
    expect(JSON.parse(profile?.content ?? '{}')).toEqual(lab);
    expect(files.map((file) => file.filename)).toEqual([
      'exporter.yaml', 'labgrid-exporter.override.conf', 'remote-pi4-01.yaml', 'remote-imx8mm-01.yaml', 'remote-nucleo-01.yaml', 'SETUP.md', 'lab-profile.json',
    ]);
  });

  it('filters the files of one bench together with the shared ones', () => {
    expect(filesForBench(files, 'bench-2').map((file) => file.filename)).toEqual([
      'exporter.yaml', 'labgrid-exporter.override.conf', 'remote-imx8mm-01.yaml', 'SETUP.md', 'lab-profile.json',
    ]);
  });

  it('keeps distinct exporter keys when two benches share a group name', () => {
    const clash = updateBench(lab, 'bench-2', { place: 'pi4-01', group: 'pi4-01' });
    const [exporter] = generateLabFiles(clash, hardwareCatalog).filter((file) => file.kind === 'exporter');
    expect(Object.keys(parse(exporter.content) as object)).toEqual(['pi4-01', 'pi4-01-2', 'nucleo-01']);
    const environments = generateLabFiles(clash, hardwareCatalog).filter((file) => file.kind === 'environment');
    expect(environments.map((file) => file.filename)).toEqual(['remote-pi4-01.yaml', 'remote-pi4-01-bench-2.yaml', 'remote-nucleo-01.yaml']);
  });

  it('reports placeholders from every bench', () => {
    const blank = updateBench(lab, 'bench-3', {
      devices: [{ id: 'dev-1', kind: 'usb-serial', label: 'Console', match: { ID_SERIAL_SHORT: '' }, speed: 115200 }],
    });
    const blankFiles = generateLabFiles(blank, hardwareCatalog);
    expect(blankFiles.find((file) => file.kind === 'exporter')?.unresolved).toEqual(['ID_SERIAL_SHORT']);
    expect(blankFiles.find((file) => file.kind === 'notes')?.content).toContain('- `<ID_SERIAL_SHORT>`');
  });

  it('records the generation time when asked', () => {
    const stamped = generateLabFiles(lab, hardwareCatalog, { generatedAt: new Date('2026-10-31T10:00:00Z') });
    expect(stamped[0].content).toContain('## Generated at: 2026-10-31T10:00:00.000Z');
  });
});

describe('lab file generation (local)', () => {
  const lab = sample('desk-local');
  const files = generateLabFiles(lab, hardwareCatalog);

  it('produces one environment per bench and no exporter', () => {
    expect(files.filter((file) => file.kind === 'exporter')).toHaveLength(0);
    expect(files.filter((file) => file.kind === 'service')).toHaveLength(0);
    const environments = files.filter((file) => file.kind === 'environment');
    expect(environments.map((file) => file.filename)).toEqual(['environment-zcu102-01.yaml', 'environment-beagleplay-01.yaml']);
    expect(environments.map((file) => file.benchId)).toEqual(['bench-1', 'bench-2']);
    const zcu = parse(environments[0].content) as { targets: { main: { resources: Record<string, unknown>; drivers: Record<string, unknown> } } };
    expect(Object.keys(zcu.targets.main.resources)).toEqual(['USBSerialPort', 'USBPowerPort']);
    expect(zcu.targets.main.drivers).toHaveProperty('UBootStrategy');
    expect(environments[0].unresolved).toEqual([]);
    expect(environments[1].unresolved).toEqual([]);
  });

  it('uses the lab name in SETUP.md and skips remote rows', () => {
    const notes = files.find((file) => file.kind === 'notes');
    expect(notes?.content).toContain('# Labgrid setup for Desk');
    expect(notes?.content).toContain('| Topology | local (this computer) |');
    expect(notes?.content).not.toContain('Exporter host');
    expect(notes?.content).toContain('| Bootloader | U-Boot, prompt "ZynqMP> " |');
  });
});

describe('single-bench labs stay compatible with bench files', () => {
  it('renders the same exporter group and drivers as generateBenchFiles', () => {
    for (const sampleBench of sampleBenches) {
      const lab = labFromProfile(sampleBench.profile);
      const labFiles = generateLabFiles(lab, hardwareCatalog);
      const benchFiles = generateBenchFiles(sampleBench.profile, hardwareCatalog);
      const stripComments = (content: string): string => content.split('\n').filter((line) => !line.startsWith('#')).join('\n');
      for (const kind of ['exporter', 'environment'] as const) {
        const fromLab = labFiles.find((file) => file.kind === kind);
        const fromBench = benchFiles.find((file) => file.kind === kind);
        expect(fromLab === undefined).toBe(fromBench === undefined);
        if (fromLab && fromBench) expect(stripComments(fromLab.content)).toBe(stripComments(fromBench.content));
      }
    }
  });

  it('names the zip after the lab, the only board, or the bench count', () => {
    expect(labZipName(sample('rack-remote'))).toBe('labgrid-rack-3.zip');
    expect(labZipName(labFromProfile(sampleBenches[0].profile))).toBe('labgrid-raspberry-pi-4-model-b.zip');
    const nameless = updateLab(addBench(labFromProfile(sampleBenches[0].profile)).lab, { name: '' });
    expect(labZipName(nameless)).toBe('labgrid-2-benches.zip');
  });
});

describe('sample labs', () => {
  it('pass lab validation and leave no placeholders', () => {
    for (const entry of sampleLabs) {
      expect(validateLab(entry.lab).errors).toEqual([]);
      for (const file of generateLabFiles(entry.lab, hardwareCatalog)) {
        expect(file.unresolved, `${entry.id}/${file.filename}`).toEqual([]);
      }
    }
  });

  it('reference presets that exist in the catalog', () => {
    for (const entry of sampleLabs) {
      for (const bench of entry.lab.benches) {
        expect(hardwareCatalog.boards.some((board) => board.id === bench.board.presetId), `${entry.id}/${bench.id}`).toBe(true);
      }
    }
  });
});
