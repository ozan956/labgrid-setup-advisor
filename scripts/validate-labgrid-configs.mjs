import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const definitions = readdirSync(join(root, 'src/data'))
  .filter((filename) => filename.endsWith('.yaml') && filename !== 'catalog.yaml')
  .map((filename) => parse(readFileSync(join(root, 'src/data', filename), 'utf8')));

const directory = mkdtempSync(join(tmpdir(), 'labgrid-advisor-'));
const manifest = [];

try {
  for (const definition of definitions) {
    const answers = Object.fromEntries(definition.questions.map((question) => [question.id, question.options[0].value]));
    answers['pdu-model'] = 'netio';

    for (const configuration of definition.configurations) {
      let content = configuration.template.replace(/\{\{answer:([a-z][a-z0-9-]*)\}\}/g, (_, id) => answers[id]);
      for (const placeholder of configuration.placeholders) {
        content = content.replaceAll(`{{${placeholder.token}}}`, placeholder.example);
      }
      parse(content);
      const path = join(directory, `${definition.id}-${configuration.id}.yaml`);
      writeFileSync(path, content);
      manifest.push({ id: `${definition.id}/${configuration.id}`, kind: configuration.kind, path });
    }
  }
  // Bench files are produced by TypeScript modules, so load them through Vite's
  // SSR module runner instead of duplicating the generator here.
  const { createServer } = await import('vite');
  const server = await createServer({
    root,
    configFile: join(root, 'vite.config.ts'),
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  try {
    const { generateBenchFiles } = await server.ssrLoadModule('/src/bench/generate.ts');
    const { hardwareCatalog } = await server.ssrLoadModule('/src/bench/catalog.ts');
    const { sampleBenches } = await server.ssrLoadModule('/src/bench/samples.ts');
    for (const sample of sampleBenches) {
      for (const file of generateBenchFiles(sample.profile, hardwareCatalog)) {
        if (file.kind !== 'environment' && file.kind !== 'exporter') continue;
        if (file.unresolved.length > 0) {
          throw new Error(`sample bench "${sample.id}" leaves ${file.filename} unresolved: ${file.unresolved.join(', ')}`);
        }
        parse(file.content);
        const path = join(directory, `bench-${sample.id}-${file.filename}`);
        writeFileSync(path, file.content);
        manifest.push({ id: `bench/${sample.id}/${file.filename}`, kind: file.kind, path });
      }
    }
  } finally {
    await server.close();
  }

  const manifestPath = join(directory, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));

  const parentVenv = resolve(root, '../.venv/bin/python');
  const python = process.env.PYTHON || (existsSync(parentVenv) ? parentVenv : 'python3');
  const parentSource = resolve(root, '..');
  const pythonPath = existsSync(join(parentSource, 'labgrid', '__init__.py'))
    ? [parentSource, process.env.PYTHONPATH].filter(Boolean).join(':')
    : process.env.PYTHONPATH;
  const result = spawnSync(python, [join(root, 'scripts/validate_with_labgrid.py'), manifestPath], {
    cwd: root,
    env: { ...process.env, PYTHONPATH: pythonPath },
    encoding: 'utf8',
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error?.code === 'ENOENT' && process.env.LABGRID_REQUIRED !== '1') {
    console.warn('Labgrid Python validation skipped: Python interpreter not found.');
  } else if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
