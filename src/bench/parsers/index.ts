import type { BenchDevice, HardwareCatalog } from '../types';
import { suggestDevices, type DetectionResult, type InputFormat } from '../detect';
import { looksLikeLsusb, parseLsusb } from './lsusb';
import { looksLikeLabgridSuggest, parseLabgridSuggest } from './suggest';
import { looksLikeUdevadm, parseUdevadm } from './udevadm';

export { parseLsusb, type LsusbEntry } from './lsusb';
export { parseUdevadm, udev, type UdevadmDevice } from './udevadm';
export { parseLabgridSuggest, type SuggestEntry } from './suggest';

/** Guess which tool produced the pasted text. labgrid-suggest is checked first because its blocks contain `ID_PATH:` lines that would otherwise look like YAML. */
export function detectInputFormat(text: string): InputFormat {
  if (looksLikeLabgridSuggest(text)) return 'labgrid-suggest';
  if (looksLikeLsusb(text)) return 'lsusb';
  if (looksLikeUdevadm(text)) return 'udevadm';
  return 'unknown';
}

/** Parse pasted tool output and turn it into device candidates for the bench profile. */
export function parseHardwareText(text: string, catalog: HardwareCatalog, existing: BenchDevice[]): DetectionResult {
  const format = detectInputFormat(text);
  switch (format) {
    case 'lsusb':
      return suggestDevices({ lsusb: parseLsusb(text) }, catalog, existing);
    case 'udevadm':
      return suggestDevices({ udevadm: parseUdevadm(text) }, catalog, existing);
    case 'labgrid-suggest':
      return suggestDevices({ suggest: parseLabgridSuggest(text) }, catalog, existing);
    default:
      return { format: 'unknown', candidates: [], skipped: [] };
  }
}
