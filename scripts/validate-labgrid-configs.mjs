import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const definition = parse(readFileSync(join(root, 'src/data/remote-power-control.yaml'), 'utf8'));
const answers = Object.fromEntries(definition.questions.map((question) => [question.id, question.options[0].value]));
answers['pdu-model'] = 'netio';

const directory = mkdtempSync(join(tmpdir(), 'labgrid-advisor-'));
const manifest = [];

try {
  for (const configuration of definition.configurations) {
    let content = configuration.template.replace(/\{\{answer:([a-z][a-z0-9-]*)\}\}/g, (_, id) => answers[id]);
    for (const placeholder of configuration.placeholders) {
      content = content.replaceAll(`{{${placeholder.token}}}`, placeholder.example);
    }
    parse(content);
    const path = join(directory, `${configuration.id}.yaml`);
    writeFileSync(path, content);
    manifest.push({ id: configuration.id, kind: configuration.kind, path });
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

