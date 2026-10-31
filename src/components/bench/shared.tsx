import { useState } from 'react';
import type { BenchDevice, DeviceKind, DeviceRole } from '../../bench/types';
import { deviceRole } from '../../bench/profile';
import { Icon } from '../Icons';

/** Plain-language names for every device kind, used by badges and the add menu. */
export const KIND_LABELS: Record<DeviceKind, string> = {
  'usb-serial': 'USB-to-serial adapter (console)',
  'network-serial': 'Network serial server (console)',
  'network-pdu': 'Network PDU outlet',
  ykush: 'Yepkit YKUSH port',
  'usb-hub-port': 'USB hub port switched with uhubctl',
  'manual-power': 'No power control yet (manual)',
  'usb-debugger': 'Debug probe for OpenOCD',
  dfu: 'DFU bootloader',
  fastboot: 'Fastboot device',
  'usb-sd-mux': 'USB-SD-Mux',
  'usb-storage': 'USB storage',
  'imx-usb-loader': 'NXP serial download (imx-usb-loader)',
  'network-service': 'SSH login (NetworkService)',
  'unsupported-usb': 'Unsupported USB device',
};

export const ROLE_LABELS: Record<DeviceRole, string> = {
  console: 'Console',
  power: 'Power',
  debug: 'Debug',
  bootstrap: 'Bootstrap',
  storage: 'Storage',
  network: 'Network',
  other: 'Other',
};

export function KindBadge({ device }: { device: BenchDevice }) {
  const role = deviceRole(device);
  return <span className={`kind-badge role-${role}`}>{ROLE_LABELS[role]}</span>;
}

export const TARGET_LABELS = {
  'exporter-host': 'exporter host',
  client: 'your computer',
  'coordinator-host': 'coordinator host',
  anywhere: 'any machine',
} as const;

export function TargetBadge({ target }: { target: keyof typeof TARGET_LABELS }) {
  return <span className={`target-badge target-${target}`}>{TARGET_LABELS[target]}</span>;
}

interface CopyButtonProps {
  text: string;
  label?: string;
  compact?: boolean;
}

export function CopyButton({ text, label = 'Copy', compact = false }: CopyButtonProps) {
  const [state, setState] = useState(label);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setState('Copied');
      window.setTimeout(() => setState(label), 1600);
    } catch {
      setState('Select and copy');
    }
  }

  return (
    <button className={`copy-button ${compact ? 'compact' : ''}`} onClick={copy} aria-live="polite" type="button">
      <Icon name="copy" /> {state}
    </button>
  );
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadText(filename: string, content: string, type = 'text/plain;charset=utf-8'): void {
  downloadBlob(filename, new Blob([content], { type }));
}

export function downloadBytes(filename: string, bytes: Uint8Array, type = 'application/zip'): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  downloadBlob(filename, new Blob([copy], { type }));
}

/** Renders one shell command with a copy button. */
export function CommandLine({ command }: { command: string }) {
  return (
    <div className="command-line">
      <pre><code>{command}</code></pre>
      <CopyButton text={command} compact />
    </div>
  );
}

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}

export function Field({ id, label, hint, children }: FieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
