import { parse } from 'yaml';
import type { UdevMatch } from '../types';

/** One device block from `labgrid-suggest` output. */
export interface SuggestEntry {
  /** Labgrid resource class, e.g. USBSerialPort. */
  resourceClass: string;
  /** sysfs device path printed after `for`. */
  devicePath: string;
  deviceNode?: string;
  vendor?: string;
  model?: string;
  portNumber?: string;
  /** Every suggested `match:` block, in output order. */
  matches: UdevMatch[];
  /** Extra attribute hints printed after a block, e.g. { index: '?' } for USBPowerPort. */
  extraKeys: Record<string, string>;
}

const HEADER = /^\s*===\s*(added|existing) device\s*===\s*$/;
const CLASS_LINE = /^\s*([A-Za-z][A-Za-z0-9]*)\s+for\s+(\S+)\s*$/;
const PROPERTIES_HEADER = /^\s*===\s*device properties\s*===\s*$/;
const MATCHES_HEADER = /^\s*===\s*suggested matches\s*===\s*$/;
const NO_MATCHES = /^\s*===\s*no suggested matches found\s*===\s*$/;
const SEPARATOR = /^\s*---\s*$/;
const EXTRA_KEY = /^\s*(index|pin):\s*(\S+)\s*$/;
const PROPERTY = /^\s*([a-z][a-z_ ()A-Z]*?):\s*(.*)$/;

const PROPERTY_FIELDS: Record<string, keyof Pick<SuggestEntry, 'deviceNode' | 'vendor' | 'model' | 'portNumber'>> = {
  'device node': 'deviceNode',
  vendor: 'vendor',
  model: 'model',
  port_number: 'portNumber',
};

function dedent(lines: string[]): string {
  const indents = lines.filter((line) => line.trim() !== '').map((line) => line.match(/^\s*/)?.[0].length ?? 0);
  const common = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(common)).join('\n');
}

function stringValue(value: unknown, original: string | undefined): string {
  if (typeof value === 'string') return value;
  if (original !== undefined) return original;
  return String(value);
}

/** Parse one YAML block (`Class:\n  match:\n    KEY: value`) into a match map. */
function parseMatchBlock(lines: string[]): { resourceClass?: string; match?: UdevMatch } {
  const text = dedent(lines);
  let value: unknown;
  try {
    value = parse(text);
  } catch {
    return {};
  }
  if (!value || typeof value !== 'object') return {};
  const [resourceClass, body] = Object.entries(value as Record<string, unknown>)[0] ?? [];
  if (!resourceClass || !body || typeof body !== 'object') return {};
  const rawMatch = (body as { match?: unknown }).match;
  if (!rawMatch || typeof rawMatch !== 'object') return { resourceClass };

  // Recover original scalar text so '00' or 0001 keep their digits.
  const originals = new Map<string, string>();
  for (const line of lines) {
    const pair = /^\s*['"]?(@?[A-Za-z0-9_]+)['"]?\s*:\s*(.+?)\s*$/.exec(line);
    if (pair) originals.set(pair[1], pair[2].replace(/^['"]|['"]$/g, ''));
  }
  const match: UdevMatch = {};
  for (const [key, raw] of Object.entries(rawMatch as Record<string, unknown>)) {
    match[key] = stringValue(raw, originals.get(key));
  }
  return { resourceClass, match };
}

/**
 * Parse `labgrid-suggest` output. Real output indents everything below the header by two
 * spaces; the man page shows it flush left. Both forms are accepted.
 */
export function parseLabgridSuggest(text: string): SuggestEntry[] {
  const entries: SuggestEntry[] = [];
  let entry: SuggestEntry | undefined;
  let section: 'none' | 'properties' | 'matches' = 'none';
  let block: string[] = [];

  function flushBlock(): void {
    if (!entry || block.length === 0) {
      block = [];
      return;
    }
    const parsed = parseMatchBlock(block);
    if (parsed.match) entry.matches.push(parsed.match);
    block = [];
  }

  function flushEntry(): void {
    flushBlock();
    if (entry) entries.push(entry);
    entry = undefined;
    section = 'none';
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (HEADER.test(line)) {
      flushEntry();
      continue;
    }
    if (!entry) {
      const classLine = CLASS_LINE.exec(line);
      if (classLine) entry = { resourceClass: classLine[1], devicePath: classLine[2], matches: [], extraKeys: {} };
      continue;
    }
    if (PROPERTIES_HEADER.test(line)) {
      flushBlock();
      section = 'properties';
      continue;
    }
    if (MATCHES_HEADER.test(line)) {
      flushBlock();
      section = 'matches';
      continue;
    }
    if (NO_MATCHES.test(line)) {
      flushBlock();
      section = 'none';
      continue;
    }
    if (section === 'properties') {
      const property = PROPERTY.exec(line);
      if (property) {
        const field = PROPERTY_FIELDS[property[1].trim()];
        if (field && property[2].trim() !== '') entry[field] = property[2].trim();
      }
      continue;
    }
    if (section === 'matches') {
      if (SEPARATOR.test(line)) {
        flushBlock();
        continue;
      }
      const extra = EXTRA_KEY.exec(line);
      if (extra && block.length > 0 && !/^\s+match:/.test(line)) {
        // `    index: ?` belongs to the resource, not to the match map.
        const indent = line.match(/^\s*/)?.[0].length ?? 0;
        const matchIndent = block.find((candidate) => /^\s*match:/.test(candidate))?.match(/^\s*/)?.[0].length;
        if (matchIndent !== undefined && indent <= matchIndent) {
          entry.extraKeys[extra[1]] = extra[2];
          continue;
        }
      }
      if (line.trim() === '') {
        flushBlock();
        continue;
      }
      block.push(line);
      continue;
    }
    // A new class line without a header (defensive).
    const classLine = CLASS_LINE.exec(line);
    if (classLine) {
      flushEntry();
      entry = { resourceClass: classLine[1], devicePath: classLine[2], matches: [], extraKeys: {} };
    }
  }
  flushEntry();
  return entries;
}

export function looksLikeLabgridSuggest(text: string): boolean {
  return text.split(/\r?\n/).some((line) => HEADER.test(line) || MATCHES_HEADER.test(line));
}
