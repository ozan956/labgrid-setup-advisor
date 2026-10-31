#!/usr/bin/env node
// Build board-preset candidates for src/data/hardware/boards.yaml from local
// source trees (U-Boot, Linux, Buildroot, OpenOCD).
//
//   node scripts/import-board-candidates.mjs --seeds scripts/board-seeds.yaml --out candidates.yaml
//
// A seed names the board and points at the files that describe it; the script
// extracts facts (prompt, baud rate, console UART, debug probe) and writes
// entries in the exact shape of boards.yaml, always marked
// `verification: unverified`, with a `sources` list and a `## derived:`
// comment block that lists the raw facts and any conflicts. A human then
// curates the candidates into the catalog and raises the verification level
// once vendor documentation confirms the facts.
//
// Only facts (strings, numbers, file names) are copied from the trees; no prose.
//
// Seed fields: id, name, vendor, family (required); uboot (defconfig name
// without _defconfig), dts (overrides CONFIG_DEFAULT_DEVICE_TREE), buildroot
// (defconfig name), openocd (tcl/board file) or openocdTarget (tcl/target
// file); optional hand-written console, power, flashing, bootloader, tags,
// notes and docs that win over derived values.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const options = {
    seeds: join(root, 'scripts/board-seeds.yaml'),
    out: undefined,
    trees: {
      uboot: resolve(root, '../../u-boot'),
      linux: resolve(root, '../../linux'),
      openocd: resolve(root, '../../openocd'),
      buildroot: resolve(root, '../../buildroot'),
    },
  };
  const flags = {
    '--seeds': (value) => { options.seeds = resolve(value); },
    '--out': (value) => { options.out = resolve(value); },
    '--u-boot': (value) => { options.trees.uboot = resolve(value); },
    '--linux': (value) => { options.trees.linux = resolve(value); },
    '--openocd': (value) => { options.trees.openocd = resolve(value); },
    '--buildroot': (value) => { options.trees.buildroot = resolve(value); },
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') {
      console.log('usage: import-board-candidates.mjs [--seeds file] [--out file] [--u-boot dir] [--linux dir] [--openocd dir] [--buildroot dir]');
      process.exit(0);
    }
    const apply = flags[flag];
    if (!apply) throw new Error(`unknown argument ${flag}`);
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    apply(value);
    index += 1;
  }
  return options;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function readText(path) {
  return readFileSync(path, 'utf8');
}

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(.)/g, '$1');
  }
  return trimmed;
}

/** Parse Kconfig-style `CONFIG_X=value` lines into a Map (strings unquoted). */
function parseKconfig(text) {
  const values = new Map();
  for (const line of text.split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1], unquote(match[2]));
  }
  return values;
}

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

/* ------------------------------------------------------------------ */
/* U-Boot                                                              */
/* ------------------------------------------------------------------ */

const maintainersCache = new Map();

/** Index every board/**\/MAINTAINERS block by the defconfig files it lists. */
function maintainersIndex(ubootDir) {
  if (maintainersCache.has(ubootDir)) return maintainersCache.get(ubootDir);
  const index = new Map();
  const boardDir = join(ubootDir, 'board');
  if (existsSync(boardDir)) {
    for (const path of walk(boardDir)) {
      if (basename(path) !== 'MAINTAINERS') continue;
      const blocks = readText(path).split(/\n\s*\n/);
      for (const block of blocks) {
        const lines = block.split('\n').map((line) => line.trimEnd()).filter(Boolean);
        if (lines.length === 0) continue;
        const title = lines[0].trim();
        const status = lines.find((line) => /^S:\s/.test(line))?.replace(/^S:\s*/, '');
        const maintainers = lines.filter((line) => /^M:\s/.test(line)).length;
        for (const line of lines) {
          const file = /^F:\s*(\S+)/.exec(line);
          if (file && /configs\/[^/]+_defconfig$/.test(file[1])) {
            index.set(file[1], { title, status, maintainers, path: relative(ubootDir, path) });
          }
        }
      }
    }
  }
  maintainersCache.set(ubootDir, index);
  return index;
}

function readUboot(ubootDir, name, report) {
  if (!name) return undefined;
  if (!existsSync(ubootDir)) {
    report.push(`u-boot tree missing; skipped configs/${name}_defconfig`);
    return undefined;
  }
  const relativePath = `configs/${name}_defconfig`;
  const path = join(ubootDir, relativePath);
  if (!existsSync(path)) {
    report.push(`u-boot defconfig ${relativePath} not found`);
    return undefined;
  }
  const config = parseKconfig(readText(path));
  // cmd/Kconfig: SYS_PROMPT defaults to "Zynq> " on ARCH_ZYNQ, "ZynqMP> " on
  // ARCH_ZYNQMP and "=> " otherwise. drivers/serial/Kconfig: BAUDRATE
  // defaults to 115200.
  const explicitPrompt = config.get('CONFIG_SYS_PROMPT');
  let prompt = explicitPrompt;
  if (prompt === undefined) {
    if (config.get('CONFIG_ARCH_ZYNQ') === 'y') prompt = 'Zynq> ';
    else if (config.get('CONFIG_ARCH_ZYNQMP') === 'y') prompt = 'ZynqMP> ';
    else prompt = '=> ';
  }
  const explicitBaud = config.get('CONFIG_BAUDRATE');
  const archKeys = [...config.keys()].filter((key) => key.startsWith('CONFIG_ARCH_') && config.get(key) === 'y');
  const targetKeys = [...config.keys()].filter((key) => key.startsWith('CONFIG_TARGET_') && config.get(key) === 'y');
  const maintainers = maintainersIndex(ubootDir).get(relativePath);
  return {
    name,
    relativePath,
    prompt,
    promptIsDefault: explicitPrompt === undefined,
    baud: explicitBaud ? Number(explicitBaud) : 115200,
    baudIsDefault: explicitBaud === undefined,
    bootdelay: config.has('CONFIG_BOOTDELAY') ? Number(config.get('CONFIG_BOOTDELAY')) : undefined,
    autobootKeyed: config.get('CONFIG_AUTOBOOT_KEYED') === 'y',
    autobootPrompt: config.get('CONFIG_AUTOBOOT_PROMPT'),
    autobootStopStr: config.get('CONFIG_AUTOBOOT_STOP_STR'),
    deviceTree: config.get('CONFIG_DEFAULT_DEVICE_TREE'),
    arm64: config.get('CONFIG_ARM64') === 'y',
    arch: archKeys.map((key) => key.replace('CONFIG_ARCH_', '').toLowerCase()),
    target: targetKeys.map((key) => key.replace('CONFIG_TARGET_', '').toLowerCase()),
    maintainers,
  };
}

/* ------------------------------------------------------------------ */
/* Linux device tree                                                   */
/* ------------------------------------------------------------------ */

const dtsArches = ['arm64', 'arm', 'riscv'];
let dtsIndex;

function indexDts(linuxDir) {
  if (dtsIndex) return dtsIndex;
  dtsIndex = new Map();
  for (const arch of dtsArches) {
    const base = join(linuxDir, 'arch', arch, 'boot/dts');
    if (!existsSync(base)) continue;
    for (const path of walk(base)) {
      if (!path.endsWith('.dts')) continue;
      const key = basename(path, '.dts');
      const list = dtsIndex.get(key) ?? [];
      list.push(path);
      dtsIndex.set(key, list);
    }
  }
  return dtsIndex;
}

function findDts(linuxDir, name) {
  for (const arch of dtsArches) {
    const direct = join(linuxDir, 'arch', arch, 'boot/dts', `${name}.dts`);
    if (existsSync(direct)) return direct;
  }
  const matches = indexDts(linuxDir).get(basename(name)) ?? [];
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    // Prefer the match whose parent directory is named in the request.
    const wanted = dirname(name);
    return matches.find((path) => wanted !== '.' && basename(dirname(path)) === wanted) ?? matches[0];
  }
  return undefined;
}

/** Read the facts of a dts, following #include "x.dtsi" in the same directory. */
function parseDtsTree(path, depth = 0, seen = new Set()) {
  const facts = { files: [], model: undefined, compatible: [], stdoutPath: undefined, stdoutFile: undefined, aliases: {} };
  if (depth > 4 || seen.has(path) || !existsSync(path)) return facts;
  seen.add(path);
  const text = readText(path);
  facts.files.push(path);
  const model = /^\s*model\s*=\s*"([^"]*)"\s*;/m.exec(text);
  if (model) facts.model = model[1];
  const compatible = /^\tcompatible\s*=\s*([^;]+);/m.exec(text);
  if (compatible) facts.compatible = [...compatible[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const stdout = /stdout-path\s*=\s*(?:"([^"]*)"|&([A-Za-z0-9_]+))\s*;/.exec(text);
  if (stdout) {
    facts.stdoutPath = stdout[1] !== undefined ? stdout[1] : `&${stdout[2]}`;
    facts.stdoutFile = path;
  }
  for (const alias of text.matchAll(/^\s*(serial[0-9]+)\s*=\s*&([A-Za-z0-9_]+)\s*;/gm)) {
    facts.aliases[alias[1]] = alias[2];
  }
  for (const include of text.matchAll(/^#include\s+"([^"]+\.dtsi?)"/gm)) {
    const includePath = join(dirname(path), include[1]);
    const nested = parseDtsTree(includePath, depth + 1, seen);
    facts.files.push(...nested.files);
    if (!facts.model && nested.model) facts.model = nested.model;
    if (facts.compatible.length === 0) facts.compatible = nested.compatible;
    if (!facts.stdoutPath && nested.stdoutPath) {
      facts.stdoutPath = nested.stdoutPath;
      facts.stdoutFile = nested.stdoutFile;
    }
    facts.aliases = { ...nested.aliases, ...facts.aliases };
  }
  return facts;
}

function readLinux(linuxDir, name, report) {
  if (!name) return undefined;
  if (!existsSync(linuxDir)) {
    report.push(`linux tree missing; skipped ${name}.dts`);
    return undefined;
  }
  const path = findDts(linuxDir, name);
  if (!path) {
    report.push(`linux dts ${name}.dts not found`);
    return undefined;
  }
  const tree = parseDtsTree(path);
  let consoleLabel;
  let consoleAlias;
  let speed;
  if (tree.stdoutPath) {
    if (tree.stdoutPath.startsWith('&')) {
      consoleLabel = tree.stdoutPath.slice(1);
      consoleAlias = Object.entries(tree.aliases).find(([, label]) => label === consoleLabel)?.[0];
    } else {
      const [target, options] = tree.stdoutPath.split(':');
      if (/^serial[0-9]+$/.test(target)) {
        consoleAlias = target;
        consoleLabel = tree.aliases[target];
      } else {
        consoleLabel = target;
      }
      const baud = /^([0-9]+)/.exec(options ?? '');
      if (baud) speed = Number(baud[1]);
    }
  }
  const arch = relative(linuxDir, path).split('/')[1];
  return {
    name,
    path,
    relativePath: relative(linuxDir, path),
    stdoutFile: tree.stdoutFile ? relative(linuxDir, tree.stdoutFile) : undefined,
    model: tree.model,
    compatible: tree.compatible,
    stdoutPath: tree.stdoutPath,
    consoleLabel,
    consoleAlias,
    speed,
    arch,
  };
}

/* ------------------------------------------------------------------ */
/* Buildroot                                                           */
/* ------------------------------------------------------------------ */

function readBuildroot(buildrootDir, name, report) {
  if (!name) return undefined;
  if (!existsSync(buildrootDir)) {
    report.push(`buildroot tree missing; skipped configs/${name}_defconfig`);
    return undefined;
  }
  const relativePath = `configs/${name}_defconfig`;
  const path = join(buildrootDir, relativePath);
  if (!existsSync(path)) {
    report.push(`buildroot defconfig ${relativePath} not found`);
    return undefined;
  }
  const config = parseKconfig(readText(path));
  const baudKey = [...config.keys()].find((key) => /^BR2_TARGET_GENERIC_GETTY_BAUDRATE_[0-9]+$/.test(key) && config.get(key) === 'y');
  return {
    name,
    relativePath,
    gettyPort: config.get('BR2_TARGET_GENERIC_GETTY_PORT'),
    gettyBaud: baudKey ? Number(baudKey.replace(/.*_/, '')) : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* OpenOCD                                                             */
/* ------------------------------------------------------------------ */

// interface script → catalog chip name (src/data/hardware/usb-devices.yaml) and
// whether that interface is normally built into the board.
const probeByInterface = {
  stlink: { chip: 'stlink', onboard: true, label: 'ST-LINK' },
  'stlink-dap': { chip: 'stlink', onboard: true, label: 'ST-LINK' },
  'stlink-hla': { chip: 'stlink', onboard: true, label: 'ST-LINK' },
  'cmsis-dap': { chip: 'daplink', onboard: true, label: 'CMSIS-DAP' },
  jlink: { chip: 'jlink', onboard: true, label: 'J-Link' },
  esp_usb_jtag: { chip: undefined, onboard: true, label: 'built-in USB Serial/JTAG' },
  xds110: { chip: 'xds110', onboard: true, label: 'XDS110' },
};

function readOpenocd(openocdDir, name, targetName, report) {
  if (!name && !targetName) return undefined;
  if (!existsSync(openocdDir)) {
    report.push(`openocd tree missing; skipped ${name ?? targetName}`);
    return undefined;
  }
  const relativePath = name ? `tcl/board/${name}.cfg` : `tcl/target/${targetName}.cfg`;
  const path = join(openocdDir, relativePath);
  if (!existsSync(path)) {
    report.push(`openocd ${name ? 'board' : 'target'} ${relativePath} not found`);
    return undefined;
  }
  const text = readText(path);
  if (!name) {
    // A target script says nothing about the probe; record that the target exists.
    return { name: targetName, relativePath, interfaces: [], targets: [targetName], transport: undefined, deprecated: /deprecated/i.test(text), probe: undefined, targetOnly: true };
  }
  const interfaces = [...text.matchAll(/source\s+\[find\s+interface\/([^\]\s]+)\.cfg\]/g)].map((match) => match[1]);
  const targets = [...text.matchAll(/source\s+\[find\s+target\/([^\]\s]+)\.cfg\]/g)].map((match) => match[1]);
  const transport = /transport\s+select\s+(\S+)/.exec(text)?.[1];
  const deprecated = /deprecated/i.test(text);
  const primary = interfaces[0];
  let probe;
  if (primary) {
    probe = probeByInterface[primary] ?? (primary.startsWith('ftdi/') ? { chip: 'ftdi', onboard: undefined, label: `FTDI (${primary})` } : { chip: undefined, onboard: false, label: primary });
  }
  return { name, relativePath, interfaces, targets, transport, deprecated, probe };
}

/* ------------------------------------------------------------------ */
/* Candidate assembly                                                  */
/* ------------------------------------------------------------------ */

function deriveCandidate(seed, facts) {
  const { uboot, linux, buildroot, openocd } = facts;
  const derived = [];
  const conflicts = [];
  const sources = [];

  if (uboot) {
    sources.push(`u-boot: ${uboot.relativePath}`);
    if (uboot.maintainers) sources.push(`u-boot: ${uboot.maintainers.path}`);
    derived.push(`u-boot prompt: ${JSON.stringify(uboot.prompt)}${uboot.promptIsDefault ? ' (Kconfig default)' : ''}`);
    derived.push(`u-boot baud: ${uboot.baud}${uboot.baudIsDefault ? ' (Kconfig default)' : ''}`);
    if (uboot.bootdelay !== undefined) derived.push(`u-boot bootdelay: ${uboot.bootdelay}`);
    if (uboot.autobootKeyed) derived.push(`u-boot autoboot keyed: prompt=${JSON.stringify(uboot.autobootPrompt ?? '')} stop=${JSON.stringify(uboot.autobootStopStr ?? '')}`);
    if (uboot.deviceTree) derived.push(`u-boot default device tree: ${uboot.deviceTree}`);
    if (uboot.maintainers) derived.push(`u-boot board: ${uboot.maintainers.title} (${uboot.maintainers.status ?? 'status unknown'})`);
    if (uboot.arch.length > 0) derived.push(`u-boot arch: ${uboot.arch.join(', ')}`);
  }
  if (linux) {
    sources.push(`linux: ${linux.relativePath}`);
    if (linux.stdoutFile && linux.stdoutFile !== linux.relativePath) sources.push(`linux: ${linux.stdoutFile}`);
    if (linux.model) derived.push(`linux model: ${JSON.stringify(linux.model)}`);
    if (linux.compatible.length > 0) derived.push(`linux compatible: ${linux.compatible.join(', ')}`);
    if (linux.stdoutPath) {
      derived.push(`linux stdout-path: ${linux.stdoutPath}${linux.consoleLabel ? ` -> ${linux.consoleLabel}` : ''}${linux.consoleAlias && linux.stdoutPath.startsWith('&') ? ` (${linux.consoleAlias})` : ''}`);
    } else {
      derived.push('linux stdout-path: not declared in this dts or its includes');
    }
  }
  if (buildroot) {
    sources.push(`buildroot: ${buildroot.relativePath}`);
    derived.push(`buildroot getty: ${buildroot.gettyPort ?? 'unset'}${buildroot.gettyBaud ? ` @ ${buildroot.gettyBaud}` : ''}`);
  }
  if (openocd) {
    sources.push(`openocd: ${openocd.relativePath}`);
    if (openocd.targetOnly) derived.push(`openocd target script exists: ${openocd.relativePath} (no board file; pick the interface yourself)`);
    else derived.push(`openocd interface: ${openocd.interfaces.join(', ') || 'none (board file selects only the target)'}; target: ${openocd.targets.join(', ') || 'none'}${openocd.transport ? `; transport ${openocd.transport}` : ''}`);
    if (openocd.deprecated) derived.push('openocd board file is marked deprecated');
  }

  // Console speed: dts stdout-path, then explicit U-Boot baud, then Buildroot,
  // then the U-Boot default.
  const speedCandidates = [];
  if (linux?.speed) speedCandidates.push({ value: linux.speed, from: 'linux stdout-path' });
  if (uboot && !uboot.baudIsDefault) speedCandidates.push({ value: uboot.baud, from: 'u-boot CONFIG_BAUDRATE' });
  if (buildroot?.gettyBaud) speedCandidates.push({ value: buildroot.gettyBaud, from: 'buildroot getty' });
  if (uboot && uboot.baudIsDefault) speedCandidates.push({ value: uboot.baud, from: 'u-boot default' });
  const distinctSpeeds = [...new Set(speedCandidates.map((candidate) => candidate.value))];
  if (distinctSpeeds.length > 1) {
    conflicts.push(`console speed differs: ${speedCandidates.map((candidate) => `${candidate.value} (${candidate.from})`).join(' vs ')}`);
  }
  const derivedSpeed = speedCandidates[0]?.value ?? (openocd ? 115200 : undefined);

  const seedConsole = seed.console ?? {};
  const probe = openocd?.probe;
  let consoleInterface = seedConsole.interface;
  if (!consoleInterface) {
    if (probe?.onboard) consoleInterface = 'cdc-acm';
    else consoleInterface = 'uart-header';
    derived.push(`console.interface guessed as ${consoleInterface}; confirm from the board documentation`);
  }
  const consoleEntry = {
    interface: consoleInterface,
    speed: seedConsole.speed ?? derivedSpeed ?? 115200,
  };
  const chip = seedConsole.chip ?? (probe?.onboard ? probe.chip : undefined);
  if (chip) consoleEntry.chip = chip;
  if (seedConsole.note) {
    consoleEntry.note = seedConsole.note;
  } else {
    const parts = [];
    if (linux?.consoleLabel) parts.push(`Linux console is ${linux.consoleLabel}${linux.consoleAlias ? ` (${linux.consoleAlias})` : ''} per the device tree.`);
    if (buildroot?.gettyPort) parts.push(`Buildroot runs getty on ${buildroot.gettyPort}.`);
    if (probe?.onboard && probe.label) parts.push(`OpenOCD board file uses the ${probe.label} interface.`);
    if (parts.length > 0) consoleEntry.note = parts.join(' ');
  }
  if (seedConsole.speed && derivedSpeed && seedConsole.speed !== derivedSpeed) {
    conflicts.push(`seed console speed ${seedConsole.speed} differs from derived ${derivedSpeed}`);
  }

  const power = seed.power ?? { inputs: ['other'], note: 'Confirm the supply connector and current from the board documentation.' };
  if (!seed.power) derived.push('power.inputs guessed as other; fill in from the board documentation');

  let flashing = seed.flashing;
  if (!flashing && openocd) flashing = ['openocd'];

  let bootloader = seed.bootloader;
  if (uboot) {
    bootloader = { kind: 'uboot', prompt: uboot.prompt, ...(seed.bootloader ?? {}) };
    if (seed.bootloader?.prompt && seed.bootloader.prompt !== uboot.prompt) {
      conflicts.push(`seed bootloader prompt ${JSON.stringify(seed.bootloader.prompt)} differs from U-Boot ${JSON.stringify(uboot.prompt)}`);
    }
  } else if (!bootloader && openocd) {
    bootloader = { kind: 'none' };
  }

  let tags = seed.tags;
  if (!tags) {
    tags = [];
    const arch = linux?.arch ?? (uboot?.arm64 ? 'arm64' : undefined);
    if (arch) tags.push(arch);
    if (uboot || linux) tags.push('linux');
    if (!uboot && !linux && openocd) tags.push('mcu');
    if (tags.length === 0) tags = undefined;
  }

  const entry = {
    id: seed.id,
    name: seed.name ?? uboot?.maintainers?.title ?? linux?.model ?? seed.id,
    vendor: seed.vendor ?? 'Unknown',
    family: seed.family ?? 'unknown',
    verification: 'unverified',
    console: consoleEntry,
    power,
  };
  if (flashing) entry.flashing = flashing;
  if (bootloader) entry.bootloader = bootloader;
  if (tags) entry.tags = tags;
  if (seed.notes) entry.notes = seed.notes;
  if (seed.docs) entry.docs = seed.docs;
  if (sources.length > 0) entry.sources = sources;

  return { entry, derived, conflicts };
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.seeds)) throw new Error(`seeds file not found: ${options.seeds}`);
  const seedsDocument = parse(readText(options.seeds));
  const seeds = seedsDocument?.seeds;
  if (!Array.isArray(seeds) || seeds.length === 0) throw new Error('seeds file needs a non-empty "seeds" list');

  for (const [key, directory] of Object.entries(options.trees)) {
    if (!existsSync(directory)) console.warn(`warning: ${key} tree not found at ${directory}; its facts will be skipped`);
  }

  const candidates = [];
  const comments = [];
  let unresolved = 0;
  const seenIds = new Set();

  for (const seed of seeds) {
    if (!seed.id) throw new Error(`seed without id: ${JSON.stringify(seed)}`);
    if (seenIds.has(seed.id)) throw new Error(`duplicate seed id ${seed.id}`);
    seenIds.add(seed.id);
    const report = [];
    const uboot = readUboot(options.trees.uboot, seed.uboot, report);
    const facts = {
      uboot,
      linux: readLinux(options.trees.linux, seed.dts ?? uboot?.deviceTree, report),
      buildroot: readBuildroot(options.trees.buildroot, seed.buildroot, report),
      openocd: readOpenocd(options.trees.openocd, seed.openocd, seed.openocdTarget, report),
    };
    const resolved = Object.values(facts).filter(Boolean).length;
    const { entry, derived, conflicts } = deriveCandidate(seed, facts);
    const summary = [
      facts.uboot ? `u-boot=${facts.uboot.name} prompt=${JSON.stringify(facts.uboot.prompt)} baud=${facts.uboot.baud}` : null,
      facts.linux ? `dts=${facts.linux.model ?? facts.linux.name}${facts.linux.consoleLabel ? ` console=${facts.linux.consoleLabel}` : ''}` : null,
      facts.buildroot ? `buildroot=${facts.buildroot.gettyPort ?? facts.buildroot.name}` : null,
      facts.openocd ? `openocd=${facts.openocd.interfaces.join('+') || facts.openocd.name}` : null,
    ].filter(Boolean);
    if (resolved === 0) {
      unresolved += 1;
      console.error(`${seed.id}: nothing resolved (${report.join('; ') || 'no pointers given'})`);
      continue;
    }
    console.log(`${seed.id}: ${summary.join(' | ')}${report.length > 0 ? ` | missing: ${report.join('; ')}` : ''}${conflicts.length > 0 ? ` | conflicts: ${conflicts.length}` : ''}`);
    candidates.push(entry);
    const lines = ['# derived:', ...derived.map((line) => `#   ${line}`)];
    if (report.length > 0) lines.push('# missing:', ...report.map((line) => `#   ${line}`));
    if (conflicts.length > 0) lines.push('# conflicts:', ...conflicts.map((line) => `#   ${line}`));
    lines.push('# next: confirm the guessed fields against vendor documentation, add docs links, then set verification: docs');
    comments.push(lines.join('\n'));
  }

  const document = new Document({ candidates });
  document.commentBefore = [
    ' Board preset candidates generated by scripts/import-board-candidates.mjs.',
    ` Seeds: ${options.seeds.startsWith(root) ? relative(root, options.seeds) : options.seeds}`,
    ' Every entry is verification: unverified until a human confirms it; paste the',
    ' entries you have checked under boards: in src/data/hardware/boards.yaml.',
  ].join('\n');
  const sequence = document.get('candidates');
  sequence.items.forEach((item, index) => {
    item.commentBefore = comments[index];
    if (index > 0) item.spaceBefore = true;
    // boards.yaml writes the short lists inline: inputs: [usb-c], tags: [arm64, linux].
    for (const key of ['flashing', 'tags']) {
      const list = item.get(key);
      if (list) list.flow = true;
    }
    const inputs = item.get('power')?.get('inputs');
    if (inputs) inputs.flow = true;
  });
  const output = document.toString({ lineWidth: 0, flowCollectionPadding: false, singleQuote: true });
  if (options.out) {
    writeFileSync(options.out, output);
    console.log(`wrote ${candidates.length} candidate(s) to ${options.out}`);
  } else {
    process.stdout.write(output);
  }
  if (unresolved > 0) {
    console.error(`${unresolved} seed(s) resolved nothing`);
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
