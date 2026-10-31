/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc32, createZip } from '../src/bench/zip';

const encoder = new TextEncoder();

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function hasPython(): boolean {
  try {
    execFileSync('python3', ['-I', '-c', 'import zipfile'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('crc32', () => {
  it('matches the reference vectors', () => {
    expect(crc32(encoder.encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
    expect(crc32(encoder.encode('a'))).toBe(0xe8b7be43);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('createZip', () => {
  const entries = [
    { name: 'exporter.yaml', content: 'board-01:\n  USBSerialPort:\n    match:\n      ID_SERIAL_SHORT: A50285BI\n' },
    { name: 'SETUP.md', content: '# Setup\n\nÜnicode ✓\n' },
  ];

  it('writes local headers, a central directory, and an end record', () => {
    const archive = createZip(entries);
    expect(readU32(archive, 0)).toBe(0x04034b50);
    expect(readU32(archive, archive.length - 22)).toBe(0x06054b50);
    expect(readU16(archive, archive.length - 22 + 8)).toBe(2);
    expect(readU16(archive, archive.length - 22 + 10)).toBe(2);
    const centralSize = readU32(archive, archive.length - 22 + 12);
    const centralOffset = readU32(archive, archive.length - 22 + 16);
    expect(readU32(archive, centralOffset)).toBe(0x02014b50);
    expect(centralOffset + centralSize + 22).toBe(archive.length);
    const data = encoder.encode(entries[0].content);
    expect(readU32(archive, 14)).toBe(crc32(data));
    expect(readU32(archive, 18)).toBe(data.length);
    expect(readU16(archive, 6) & (1 << 11)).toBe(1 << 11);
  });

  it('is deterministic by default and honours an explicit date', () => {
    expect(createZip(entries)).toEqual(createZip(entries));
    const dated = createZip(entries, { date: new Date(2026, 9, 31, 10, 30, 0) });
    expect(dated).not.toEqual(createZip(entries));
    expect(readU16(dated, 12)).toBe((2026 - 1980) << 9 | (10 << 5) | 31);
  });

  it('produces an archive Python can read back', () => {
    if (!hasPython()) return;
    const dir = mkdtempSync(join(tmpdir(), 'labgrid-advisor-zip-'));
    const path = join(dir, 'bundle.zip');
    writeFileSync(path, createZip(entries));
    let output: string;
    try {
      output = execFileSync(
        'python3',
        ['-I', '-c', "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip()); print(sorted(z.namelist())); print(z.read('SETUP.md').decode())", path],
        { encoding: 'utf8' },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(output).toContain('None');
    expect(output).toContain("['SETUP.md', 'exporter.yaml']");
    expect(output).toContain('Ünicode ✓');
  });
});
