/**
 * Minimal store-only ZIP writer (no compression) so the advisor can offer a
 * one-click bundle download without a runtime dependency.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  content: string;
}

export interface ZipOptions {
  /** Timestamp written into every entry. Defaults to 1980-01-01 00:00 so archives are deterministic. */
  date?: Date;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: day };
}

class ByteWriter {
  private chunks: Uint8Array[] = [];
  length = 0;

  u16(value: number): void {
    this.bytes(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]));
  }

  u32(value: number): void {
    this.bytes(new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]));
  }

  bytes(value: Uint8Array): void {
    this.chunks.push(value);
    this.length += value.length;
  }

  concat(): Uint8Array {
    const output = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }
}

const UTF8_FLAG = 1 << 11;

export function createZip(entries: ZipEntry[], options: ZipOptions = {}): Uint8Array {
  const encoder = new TextEncoder();
  const stamp = dosDateTime(options.date ?? new Date(1980, 0, 1, 0, 0, 0));
  const writer = new ByteWriter();
  const central = new ByteWriter();

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = encoder.encode(entry.content);
    const checksum = crc32(data);
    const offset = writer.length;

    writer.u32(0x04034b50);
    writer.u16(20);
    writer.u16(UTF8_FLAG);
    writer.u16(0);
    writer.u16(stamp.time);
    writer.u16(stamp.date);
    writer.u32(checksum);
    writer.u32(data.length);
    writer.u32(data.length);
    writer.u16(name.length);
    writer.u16(0);
    writer.bytes(name);
    writer.bytes(data);

    central.u32(0x02014b50);
    central.u16(20);
    central.u16(20);
    central.u16(UTF8_FLAG);
    central.u16(0);
    central.u16(stamp.time);
    central.u16(stamp.date);
    central.u32(checksum);
    central.u32(data.length);
    central.u32(data.length);
    central.u16(name.length);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u32(0);
    central.u32(offset);
    central.bytes(name);
  }

  const centralStart = writer.length;
  const centralBytes = central.concat();
  writer.bytes(centralBytes);
  writer.u32(0x06054b50);
  writer.u16(0);
  writer.u16(0);
  writer.u16(entries.length);
  writer.u16(entries.length);
  writer.u32(centralBytes.length);
  writer.u32(centralStart);
  writer.u16(0);
  return writer.concat();
}
