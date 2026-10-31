import { Children, cloneElement, isValidElement, useEffect, useState, type ReactElement, type ReactNode } from 'react';
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
  /** Visible label, e.g. 'Copy'. */
  label?: string;
  /** Accessible name when the visible label is too generic, e.g. 'Copy exporter.yaml'. */
  ariaLabel?: string;
  compact?: boolean;
}

export function CopyButton({ text, label = 'Copy', ariaLabel, compact = false }: CopyButtonProps) {
  const [state, setState] = useState(label);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setState('Copied');
      window.setTimeout(() => setState(label), 1600);
    } catch {
      setState('Select and copy');
      window.setTimeout(() => setState(label), 4000);
    }
  }

  const name = ariaLabel && state === label ? ariaLabel : state;
  return (
    <button
      className={`copy-button ${compact ? 'compact' : ''}`}
      onClick={copy}
      aria-live="polite"
      aria-label={name}
      title={name}
      type="button"
    >
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
  // Some WebKit builds abort the download when the URL is revoked immediately.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
      <CopyButton text={command} compact ariaLabel={`Copy command: ${command.slice(0, 60)}`} />
    </div>
  );
}

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}

type ElementWithProps = ReactElement<{ id?: string; children?: ReactNode; 'aria-describedby'?: string }>;

/** Adds aria-describedby to the element carrying the field id, looking one level into wrappers. */
function describe(node: ReactNode, id: string, hintId: string): ReactNode {
  return Children.map(node, (child) => {
    if (!isValidElement(child)) return child;
    const element = child as ElementWithProps;
    if (element.props.id === id) {
      const existing = element.props['aria-describedby'];
      return cloneElement(element, { 'aria-describedby': existing ? `${existing} ${hintId}` : hintId });
    }
    if (typeof element.type === 'string' && element.props.children !== undefined) {
      return cloneElement(element, {}, describe(element.props.children, id, hintId));
    }
    return child;
  });
}

export function Field({ id, label, hint, children }: FieldProps) {
  const hintId = `${id}-hint`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint ? describe(children, id, hintId) : children}
      {hint && <small id={hintId}>{hint}</small>}
    </div>
  );
}

interface NumberInputProps {
  id: string;
  value: number;
  min?: number;
  max?: number;
  onCommit: (value: number) => void;
  'aria-label'?: string;
}

/**
 * A number field that keeps the text while the user edits (so it can be
 * cleared) and only commits integers within range to the profile.
 */
export function NumberInput({ id, value, min = 1, max, onCommit, ...rest }: NumberInputProps) {
  const [text, setText] = useState(String(value));
  const [committed, setCommitted] = useState(value);
  useEffect(() => {
    if (value !== committed) {
      setCommitted(value);
      setText(String(value));
    }
  }, [value, committed]);

  const parsed = Number(text);
  const valid = text.trim() !== '' && Number.isInteger(parsed) && parsed >= min && (max === undefined || parsed <= max);

  return (
    <input
      id={id}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={text}
      aria-invalid={text.trim() !== '' && !valid ? true : undefined}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const number = Number(next);
        if (next.trim() !== '' && Number.isInteger(number) && number >= min && (max === undefined || number <= max)) {
          setCommitted(number);
          onCommit(number);
        }
      }}
      onBlur={() => {
        if (!valid) setText(String(committed));
      }}
      {...rest}
    />
  );
}
