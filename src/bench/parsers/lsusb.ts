/** One line of `lsusb` output. */
export interface LsusbEntry {
  bus: string;
  device: string;
  /** Lower-case four-digit hexadecimal vendor id. */
  vendorId: string;
  /** Lower-case four-digit hexadecimal product id. */
  productId: string;
  /** Vendor and product text as printed by lsusb; may be empty. */
  description: string;
}

const LINE = /^\s*Bus\s+(\d+)\s+Device\s+(\d+):\s*ID\s+([0-9a-fA-F]{4}):([0-9a-fA-F]{4})\s*(.*?)\s*$/;

/**
 * Parse `lsusb` output. Lines that do not look like `Bus 001 Device 002: ID 10c4:ea60 ...`
 * are ignored, so verbose dumps (`lsusb -v`) and pasted shell prompts are tolerated.
 */
export function parseLsusb(text: string): LsusbEntry[] {
  const entries: LsusbEntry[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const match = LINE.exec(rawLine);
    if (!match) continue;
    const [, bus, device, vendorId, productId, description] = match;
    entries.push({
      bus,
      device,
      vendorId: vendorId.toLowerCase(),
      productId: productId.toLowerCase(),
      description: description ?? '',
    });
  }
  return entries;
}

/** True when the text contains at least one lsusb device line. */
export function looksLikeLsusb(text: string): boolean {
  return text.split(/\r?\n/).some((line) => LINE.test(line));
}
