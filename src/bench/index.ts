export * from './types';
export * from './profile';
export { hardwareCatalog, loadHardwareCatalog, findUsbDevice, findPduModel, findBoard, searchBoards, validateBoardPreset, HardwareCatalogError } from './catalog';
export { boardPresetFromProfile, renderBoardPresetYaml, boardIdFromName } from './preset';
export type { BoardPresetOptions } from './preset';
export { parseLsusb } from './parsers/lsusb';
export { parseUdevadm } from './parsers/udevadm';
export { parseLabgridSuggest } from './parsers/suggest';
export { detectInputFormat, parseHardwareText } from './parsers/index';
export { suggestDevices } from './detect';
export type { DetectedCandidate, DetectionResult, InputFormat } from './detect';
export { analyzeProfile } from './insights';
export { prefillForUseCase, prefillAll, applyPrefill } from './prefill';
export { generateBenchFiles } from './generate';
export { buildChecklist } from './checklist';
export { createZip } from './zip';
export {
  STORAGE_KEY, LAB_STORAGE_KEY, validateProfile, saveProfile, loadProfile, clearProfile, encodeShareHash, decodeShareHash, summarizeProfile,
  validateLab, validateLabOrProfile, saveLab, loadLab, clearLab, encodeLabShareHash, decodeLabShareHash, hasShareHash, summarizeLab,
} from './storage';
export * from './lab';
export { generateLabFiles, filesForBench, labZipName } from './lab-files';
export { analyzeLab, insightsForBench, benchLabel } from './lab-insights';
export { buildLabChecklist, unionProfile } from './lab-checklist';
export { sampleLabs } from './lab-samples';
export type { SampleLab } from './lab-samples';
export { sampleBenches } from './samples';
export type { SampleBench } from './samples';
