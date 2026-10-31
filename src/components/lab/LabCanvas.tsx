/**
 * Interactive lab diagram: the exporter host on top, one tile per bench with
 * its device bricks stacked above the board block, and a palette of bricks
 * to drag in. Every edit goes through the pure operations in src/bench/lab.ts
 * and is handed back through `onChange`; the canvas itself holds only
 * transient drag, focus and announcement state.
 */

import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type FocusEvent } from 'react';
import './lab-canvas.css';
import { findBoard } from '../../bench/catalog';
import { resourceClassOf } from '../../bench/checklist';
import { MAX_BENCHES, addBench, addDevice, benchOfDevice, findBench, moveDevice, removeDevice } from '../../bench/lab';
import { ADDABLE_KINDS, DEFAULT_COORDINATOR, blankDevice, deviceRole } from '../../bench/profile';
import type { BenchDevice, BoardVerification, DeviceKind, HardwareCatalog, Lab, LabBench } from '../../bench/types';
import { KIND_LABELS, KindBadge } from '../bench/shared';

export interface LabCanvasProps {
  lab: Lab;
  catalog: HardwareCatalog;
  selectedBenchId?: string;
  selectedDeviceId?: string;
  /** No palette, no drag, no toolbar; selection still works. */
  readOnly?: boolean;
  /** Receives the new lab after a move, add or remove. */
  onChange?: (lab: Lab) => void;
  onSelectBench?: (benchId: string) => void;
  onSelectDevice?: (benchId: string, deviceId: string) => void;
  /** When given, announcements go to the parent's live region instead of the canvas's own. */
  onAnnounce?: (text: string) => void;
}

export const DEVICE_MIME = 'application/x-labgrid-device';
export const KIND_MIME = 'application/x-labgrid-kind';
const CONFIRM_MS = 4000;
const NETWORK_KINDS: ReadonlySet<DeviceKind> = new Set<DeviceKind>(['network-pdu', 'network-serial', 'network-service']);

const VERIFICATION_TEXT: Record<BoardVerification, string> = {
  lab: 'Verified on hardware',
  docs: 'From documentation',
  unverified: 'Not yet reviewed',
};

/** Short brick names for the palette; the full KIND_LABELS go into the accessible names. */
const PALETTE_NAMES: Record<DeviceKind, string> = {
  'usb-serial': 'USB serial console',
  'network-serial': 'Network serial console',
  'network-pdu': 'PDU outlet',
  ykush: 'YKUSH port',
  'usb-hub-port': 'USB hub port',
  'manual-power': 'Manual power',
  'usb-debugger': 'Debug probe',
  dfu: 'DFU',
  fastboot: 'Fastboot',
  'usb-sd-mux': 'USB-SD-Mux',
  'usb-storage': 'USB storage',
  'imx-usb-loader': 'i.MX serial download',
  'network-service': 'SSH service',
  'unsupported-usb': 'Unsupported USB',
};

type Drag =
  | { source: 'device'; benchId: string; deviceId: string }
  | { source: 'palette'; kind: DeviceKind };

interface Hover {
  benchId: string;
  /** Insert before this device instead of appending. */
  beforeDeviceId?: string;
}

interface Link {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  network: boolean;
}

/** What the user calls a bench: its place name, else the board, else the id. */
export function benchLabel(bench: LabBench): string {
  return bench.place.trim() || bench.board.name.trim() || bench.id;
}

function freeDeviceId(bench: LabBench): string {
  const taken = new Set(bench.devices.map(({ id }) => id));
  let n = bench.devices.length + 1;
  while (taken.has(`dev-${n}`)) n += 1;
  return `dev-${n}`;
}

function isNetwork(device: BenchDevice): boolean {
  return NETWORK_KINDS.has(device.kind);
}

function brickKey(benchId: string, deviceId: string): string {
  return `${benchId}/${deviceId}`;
}

/** Payload of a drop, from the data transfer when the drag did not start in this canvas. */
function readDrag(event: DragEvent): Drag | undefined {
  const transfer = event.dataTransfer;
  if (!transfer) return undefined;
  try {
    const device = transfer.getData(DEVICE_MIME);
    if (device) {
      const parsed = JSON.parse(device) as { benchId?: unknown; deviceId?: unknown };
      if (typeof parsed.benchId === 'string' && typeof parsed.deviceId === 'string') {
        return { source: 'device', benchId: parsed.benchId, deviceId: parsed.deviceId };
      }
    }
    const kind = transfer.getData(KIND_MIME);
    if (kind && (ADDABLE_KINDS as string[]).includes(kind)) return { source: 'palette', kind: kind as DeviceKind };
  } catch {
    // Malformed payload from another page; ignore the drop.
  }
  return undefined;
}

function transferTypes(event: DragEvent): string[] {
  const types = event.dataTransfer?.types;
  return types ? Array.from(types as ArrayLike<string>) : [];
}

function NetworkGlyph() {
  return (
    <svg className="lab-network-glyph" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <circle cx="6" cy="2.5" r="1.7" />
      <circle cx="2.5" cy="9.5" r="1.7" />
      <circle cx="9.5" cy="9.5" r="1.7" />
      <path d="M6 4.2v2.3M6 6.5 2.5 7.9M6 6.5l3.5 1.4" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

function HostBlock({ title, subtitle, service = false }: { title: string; subtitle: string; service?: boolean }) {
  return (
    <div className={`lab-host-block${service ? ' service' : ''}`}>
      <span className="lab-host-title">{title}</span>
      <span className="lab-host-subtitle">{subtitle}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Brick                                                               */
/* ------------------------------------------------------------------ */

interface BrickProps {
  bench: LabBench;
  device: BenchDevice;
  index: number;
  otherBenches: LabBench[];
  selected: boolean;
  active: boolean;
  readOnly: boolean;
  dragging: boolean;
  dropBefore: boolean;
  confirming: boolean;
  onSelect: () => void;
  onActive: (active: boolean) => void;
  onDragStart: (event: DragEvent) => void;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
  onDragEnd: () => void;
  onMoveTo: (benchId: string) => void;
  onNudge: (delta: 1 | -1) => void;
  onRemove: () => void;
}

function Brick({
  bench, device, index, otherBenches, selected, active, readOnly, dragging, dropBefore, confirming,
  onSelect, onActive, onDragStart, onDragOver, onDrop, onDragEnd, onMoveTo, onNudge, onRemove,
}: BrickProps) {
  const label = device.label.trim() || KIND_LABELS[device.kind];
  const resourceClass = resourceClassOf(device);
  const role = deviceRole(device);
  const classes = ['lab-brick', `role-${role}`];
  if (selected) classes.push('selected');
  if (dragging) classes.push('dragging');
  if (dropBefore) classes.push('drop-before');
  const name = `${label}: ${KIND_LABELS[device.kind]}${resourceClass ? `, ${resourceClass}` : ''}`;

  function blur(event: FocusEvent<HTMLDivElement>): void {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onActive(false);
  }

  return (
    <div
      className={classes.join(' ')}
      role="group"
      aria-label={`${label} on ${benchLabel(bench)}`}
      draggable={!readOnly}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onFocus={() => onActive(true)}
      onBlur={blur}
    >
      <button type="button" className="lab-brick-main" onClick={onSelect} aria-label={name} aria-current={selected ? 'true' : undefined}>
        <span className="lab-brick-title">{label}</span>
        <span className="lab-brick-meta">
          <KindBadge device={device} />
          {resourceClass && <code className="lab-brick-class">{resourceClass}</code>}
          {isNetwork(device) && <span className="lab-brick-network" title="Reached over the network"><NetworkGlyph /></span>}
        </span>
      </button>
      {!readOnly && (selected || active) && (
        <div className="lab-brick-toolbar" role="group" aria-label={`${label} actions`}>
          {otherBenches.length > 0 && (
            <select
              className="lab-mini-select"
              value=""
              aria-label={`Move ${label} to another bench`}
              onChange={(event) => { if (event.target.value) onMoveTo(event.target.value); }}
            >
              <option value="">Move to…</option>
              {otherBenches.map((other) => <option key={other.id} value={other.id}>{benchLabel(other)}</option>)}
            </select>
          )}
          <button className="lab-mini-button" type="button" onClick={() => onNudge(-1)} disabled={index === 0} aria-label={`Move ${label} up`}>↑ Up</button>
          <button className="lab-mini-button" type="button" onClick={() => onNudge(1)} disabled={index === bench.devices.length - 1} aria-label={`Move ${label} down`}>↓ Down</button>
          <button
            className={`lab-mini-button danger${confirming ? ' confirming' : ''}`}
            type="button"
            onClick={onRemove}
            aria-label={confirming ? `Confirm removing ${label} from ${benchLabel(bench)}` : `Remove ${label} from ${benchLabel(bench)}`}
          >
            {confirming ? 'Confirm remove' : 'Remove'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Canvas                                                              */
/* ------------------------------------------------------------------ */

export function LabCanvas({
  lab, catalog, selectedBenchId, selectedDeviceId, readOnly = false, onChange, onSelectBench, onSelectDevice,
  onAnnounce,
}: LabCanvasProps) {
  const [drag, setDrag] = useState<Drag>();
  const [hover, setHover] = useState<Hover>();
  const [activeKey, setActiveKey] = useState<string>();
  const [confirmKey, setConfirmKey] = useState<string>();
  const [announcement, setAnnouncement] = useState('');
  const [links, setLinks] = useState<Link[]>([]);
  const rackRef = useRef<HTMLDivElement>(null);
  const linksRef = useRef('');
  const confirmTimer = useRef<number | undefined>(undefined);

  const resolvedBenchId = selectedBenchId ?? (selectedDeviceId ? benchOfDevice(lab, selectedDeviceId)?.id : undefined);
  const selectedBench = resolvedBenchId ? findBench(lab, resolvedBenchId) : undefined;
  const paletteTarget = selectedBench ?? (lab.benches.length === 1 ? lab.benches[0] : undefined);
  const remote = lab.topology === 'remote';
  const coordinator = lab.names.coordinator.trim() || DEFAULT_COORDINATOR;
  const exporterHost = lab.names.exporterHost.trim() || 'the exporter host';

  useEffect(() => () => window.clearTimeout(confirmTimer.current), []);

  // Connectors from the host bar to each tile, measured from the DOM so they
  // follow wrapping and resizing. Positions are zero in jsdom, which is fine.
  useLayoutEffect(() => {
    const rack = rackRef.current;
    if (!rack) return undefined;
    let frame = 0;
    const measure = (): void => {
      // Devices hang off the machine they are plugged into: the exporter in a
      // remote lab, which is the last host block, or the only block locally.
      const blocks = rack.querySelectorAll<HTMLElement>('.lab-host-bar .lab-host-block');
      const host = blocks[blocks.length - 1] ?? rack.querySelector<HTMLElement>('.lab-host-bar');
      if (!host) return;
      const base = rack.getBoundingClientRect();
      const hostBox = host.getBoundingClientRect();
      const x1 = hostBox.left - base.left + hostBox.width / 2;
      const y1 = hostBox.bottom - base.top;
      const next: Link[] = [];
      rack.querySelectorAll<HTMLElement>('.lab-tile[data-bench-id]').forEach((tile) => {
        const box = tile.getBoundingClientRect();
        const x2 = box.left - base.left + box.width / 2;
        const y2 = box.top - base.top;
        const benchId = tile.dataset.benchId ?? '';
        const usb = tile.dataset.usb === 'true';
        const network = tile.dataset.network === 'true';
        if (usb || !network) next.push({ key: `${benchId}-usb`, x1, y1, x2, y2, network: false });
        if (network) next.push({ key: `${benchId}-net`, x1: x1 + 10, y1, x2: x2 + 10, y2, network: true });
      });
      const serialized = JSON.stringify(next);
      if (serialized !== linksRef.current) {
        linksRef.current = serialized;
        setLinks(next);
      }
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(() => {
          window.cancelAnimationFrame(frame);
          frame = window.requestAnimationFrame(measure);
        });
    observer?.observe(rack);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [lab, readOnly]);

  function announce(text: string): void {
    if (onAnnounce) onAnnounce(text);
    else setAnnouncement(text);
  }

  function commit(next: Lab): void {
    if (next !== lab) onChange?.(next);
  }

  function finishDrag(): void {
    setDrag(undefined);
    setHover(undefined);
  }

  /* ---- drops ---- */

  function dropInto(benchId: string, beforeDeviceId: string | undefined, payload: Drag | undefined): void {
    if (!payload) return;
    const target = findBench(lab, benchId);
    if (!target) return;
    let index = beforeDeviceId ? target.devices.findIndex((device) => device.id === beforeDeviceId) : -1;
    if (index === -1) index = target.devices.length;

    if (payload.source === 'palette') {
      const device = blankDevice(payload.kind, freeDeviceId(target));
      commit(addDevice(lab, benchId, device, index));
      onSelectDevice?.(benchId, device.id);
      announce(`${device.label} added to ${benchLabel(target)}`);
      return;
    }

    const source = findBench(lab, payload.benchId);
    const device = source?.devices.find((item) => item.id === payload.deviceId);
    if (!source || !device) return;
    const label = device.label.trim() || KIND_LABELS[device.kind];

    if (source.id === benchId) {
      if (beforeDeviceId === device.id) return;
      const from = source.devices.findIndex((item) => item.id === device.id);
      const position = beforeDeviceId === undefined ? source.devices.length - 1 : from < index ? index - 1 : index;
      if (position === from) return;
      commit(moveDevice(lab, device.id, benchId, benchId, position));
      onSelectDevice?.(benchId, device.id);
      announce(`${label} moved ${position < from ? 'up' : 'down'} in ${benchLabel(source)}`);
      return;
    }

    const next = moveDevice(lab, device.id, source.id, benchId, index);
    const placed = findBench(next, benchId)?.devices[index];
    commit(next);
    if (placed) onSelectDevice?.(benchId, placed.id);
    announce(`${label} moved to ${benchLabel(target)}`);
  }

  function allowDrop(event: DragEvent): boolean {
    if (readOnly) return false;
    const types = transferTypes(event);
    const ours = drag !== undefined || types.includes(DEVICE_MIME) || types.includes(KIND_MIME);
    if (!ours) return false;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = drag?.source === 'palette' || types.includes(KIND_MIME) ? 'copy' : 'move';
    }
    return true;
  }

  function startDeviceDrag(event: DragEvent, bench: LabBench, device: BenchDevice): void {
    if (readOnly) {
      event.preventDefault();
      return;
    }
    event.dataTransfer?.setData(DEVICE_MIME, JSON.stringify({ benchId: bench.id, deviceId: device.id }));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    setDrag({ source: 'device', benchId: bench.id, deviceId: device.id });
  }

  function startPaletteDrag(event: DragEvent, kind: DeviceKind): void {
    event.dataTransfer?.setData(KIND_MIME, kind);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
    setDrag({ source: 'palette', kind });
  }

  function tileDragOver(event: DragEvent, bench: LabBench): void {
    if (!allowDrop(event)) return;
    setHover((current) => (current?.benchId === bench.id && current.beforeDeviceId === undefined ? current : { benchId: bench.id }));
  }

  function tileDragLeave(event: DragEvent, bench: LabBench): void {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setHover((current) => (current?.benchId === bench.id ? undefined : current));
  }

  function tileDrop(event: DragEvent, bench: LabBench): void {
    if (readOnly) return;
    event.preventDefault();
    dropInto(bench.id, undefined, drag ?? readDrag(event));
    finishDrag();
  }

  function brickDragOver(event: DragEvent, bench: LabBench, device: BenchDevice): void {
    if (!allowDrop(event)) return;
    event.stopPropagation();
    setHover((current) => (current?.benchId === bench.id && current.beforeDeviceId === device.id ? current : { benchId: bench.id, beforeDeviceId: device.id }));
  }

  function brickDrop(event: DragEvent, bench: LabBench, device: BenchDevice): void {
    if (readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    dropInto(bench.id, device.id, drag ?? readDrag(event));
    finishDrag();
  }

  /* ---- keyboard path ---- */

  function moveToBench(bench: LabBench, device: BenchDevice, toBenchId: string): void {
    const target = findBench(lab, toBenchId);
    if (!target) return;
    const next = moveDevice(lab, device.id, bench.id, toBenchId);
    const placed = findBench(next, toBenchId)?.devices.at(-1);
    commit(next);
    if (placed) onSelectDevice?.(toBenchId, placed.id);
    announce(`${device.label.trim() || KIND_LABELS[device.kind]} moved to ${benchLabel(target)}`);
  }

  function nudge(bench: LabBench, device: BenchDevice, delta: 1 | -1): void {
    const from = bench.devices.findIndex((item) => item.id === device.id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= bench.devices.length) return;
    commit(moveDevice(lab, device.id, bench.id, bench.id, to));
    announce(`${device.label.trim() || KIND_LABELS[device.kind]} moved ${delta < 0 ? 'up' : 'down'} in ${benchLabel(bench)}`);
  }

  function remove(bench: LabBench, device: BenchDevice): void {
    const key = brickKey(bench.id, device.id);
    window.clearTimeout(confirmTimer.current);
    if (confirmKey !== key) {
      setConfirmKey(key);
      confirmTimer.current = window.setTimeout(() => setConfirmKey(undefined), CONFIRM_MS);
      return;
    }
    setConfirmKey(undefined);
    commit(removeDevice(lab, bench.id, device.id));
    announce(`Removed ${device.label.trim() || KIND_LABELS[device.kind]} from ${benchLabel(bench)}`);
  }

  function addFromPalette(kind: DeviceKind): void {
    if (!paletteTarget) {
      announce('Select a bench first, or drag the brick onto one.');
      return;
    }
    const device = blankDevice(kind, freeDeviceId(paletteTarget));
    commit(addDevice(lab, paletteTarget.id, device));
    onSelectDevice?.(paletteTarget.id, device.id);
    announce(`${device.label} added to ${benchLabel(paletteTarget)}`);
  }

  function newBench(): void {
    if (lab.benches.length >= MAX_BENCHES) return;
    const { lab: next, bench } = addBench(lab);
    commit(next);
    onSelectBench?.(bench.id);
    announce(`Added bench ${benchLabel(bench)}`);
  }

  /* ---- description ---- */

  const benchSummary = lab.benches
    .map((bench) => `${bench.board.name.trim() || 'an unnamed board'} (${benchLabel(bench)}, ${bench.devices.length} device${bench.devices.length === 1 ? '' : 's'})`)
    .join('; ');
  const count = `${lab.benches.length} bench${lab.benches.length === 1 ? '' : 'es'}`;
  const description = remote
    ? `Lab diagram: your computer talks to the coordinator at ${coordinator}, which hands out resources exported by ${exporterHost} for ${count}: ${benchSummary}.`
    : `Lab diagram: this computer drives ${count} directly: ${benchSummary}.`;

  return (
    <div className={`lab-canvas${readOnly ? ' read-only' : ''}`} role="group" aria-label={description}>
      <div className="lab-rack" ref={rackRef}>
        <svg className="lab-links" aria-hidden="true" focusable="false">
          {links.map((link) => {
            const mid = (link.y1 + link.y2) / 2;
            return (
              <path
                key={link.key}
                className={`lab-link${link.network ? ' network' : ''}`}
                d={`M${link.x1} ${link.y1} C ${link.x1} ${mid}, ${link.x2} ${mid}, ${link.x2} ${link.y2}`}
              />
            );
          })}
        </svg>

        <div className="lab-host-bar">
          {remote ? (
            <>
              <HostBlock title="Your computer" subtitle="labgrid-client / pytest" />
              <span className="lab-host-arrow" aria-hidden="true">→</span>
              <HostBlock title="Coordinator" subtitle={coordinator} service />
              <span className="lab-host-arrow" aria-hidden="true">→</span>
              <HostBlock title="Exporter" subtitle={lab.names.exporterHost.trim() || 'exporter host'} />
            </>
          ) : (
            <HostBlock title="This computer" subtitle="labgrid environment" />
          )}
        </div>

        <div className="lab-tiles">
          {lab.benches.map((bench) => {
            const boardName = bench.board.name.trim() || 'Unnamed board';
            const preset = bench.board.presetId ? findBoard(catalog, bench.board.presetId) : undefined;
            const tileSelected = selectedBench?.id === bench.id;
            const tileClasses = ['lab-tile'];
            if (tileSelected) tileClasses.push('selected');
            if (hover?.benchId === bench.id) tileClasses.push('drop-target');
            const otherBenches = lab.benches.filter((other) => other.id !== bench.id);
            return (
              <section
                key={bench.id}
                className={tileClasses.join(' ')}
                aria-label={`Bench ${benchLabel(bench)}: ${boardName}`}
                data-bench-id={bench.id}
                data-usb={bench.devices.some((device) => !isNetwork(device)) ? 'true' : 'false'}
                data-network={bench.devices.some(isNetwork) ? 'true' : 'false'}
                onDragOver={(event) => tileDragOver(event, bench)}
                onDragLeave={(event) => tileDragLeave(event, bench)}
                onDrop={(event) => tileDrop(event, bench)}
              >
                <div className="lab-bricks">
                  {bench.devices.map((device, index) => {
                    const key = brickKey(bench.id, device.id);
                    return (
                      <Brick
                        key={device.id}
                        bench={bench}
                        device={device}
                        index={index}
                        otherBenches={otherBenches}
                        selected={tileSelected && selectedDeviceId === device.id}
                        active={activeKey === key}
                        readOnly={readOnly}
                        dragging={drag?.source === 'device' && drag.benchId === bench.id && drag.deviceId === device.id}
                        dropBefore={hover?.benchId === bench.id && hover.beforeDeviceId === device.id}
                        confirming={confirmKey === key}
                        onSelect={() => onSelectDevice?.(bench.id, device.id)}
                        onActive={(active) => setActiveKey((current) => (active ? key : current === key ? undefined : current))}
                        onDragStart={(event) => startDeviceDrag(event, bench, device)}
                        onDragOver={(event) => brickDragOver(event, bench, device)}
                        onDrop={(event) => brickDrop(event, bench, device)}
                        onDragEnd={finishDrag}
                        onMoveTo={(toBenchId) => moveToBench(bench, device, toBenchId)}
                        onNudge={(delta) => nudge(bench, device, delta)}
                        onRemove={() => remove(bench, device)}
                      />
                    );
                  })}
                </div>
                {!readOnly ? (
                  <div className="lab-dropzone" aria-hidden="true">
                    {bench.devices.length === 0 ? 'No devices yet. Drop a brick here or pick one from the palette.' : 'Drop here to add to this bench'}
                  </div>
                ) : bench.devices.length === 0 && <p className="lab-empty">No devices</p>}
                <button
                  type="button"
                  className="lab-board"
                  onClick={() => onSelectBench?.(bench.id)}
                  aria-label={`Board ${boardName}, place ${benchLabel(bench)}`}
                  aria-current={tileSelected ? 'true' : undefined}
                >
                  <span className="lab-board-name">{boardName}</span>
                  <span className="lab-board-place">{bench.place.trim() || 'no place name yet'}</span>
                  {preset && (
                    <span className={`verification-badge verification-${preset.verification}`}>{VERIFICATION_TEXT[preset.verification]}</span>
                  )}
                </button>
              </section>
            );
          })}
          {!readOnly && (
            <div className="lab-add-tile">
              <button
                className="button secondary"
                type="button"
                onClick={newBench}
                disabled={lab.benches.length >= MAX_BENCHES}
                title={lab.benches.length >= MAX_BENCHES ? `A lab holds at most ${MAX_BENCHES} benches` : undefined}
              >
                + Add bench
              </button>
            </div>
          )}
        </div>
      </div>

      {!readOnly && (
        <div className="lab-palette" role="group" aria-label="Device bricks">
          <p className="lab-palette-hint">
            {paletteTarget
              ? `Drag a brick onto a bench, or click one to add it to ${benchLabel(paletteTarget)}.`
              : 'Drag a brick onto a bench, or select a bench first to add bricks by clicking.'}
          </p>
          {ADDABLE_KINDS.map((kind) => {
            const sample = blankDevice(kind, 'palette');
            return (
              <button
                key={kind}
                type="button"
                className={`lab-palette-brick role-${deviceRole(sample)}`}
                draggable
                onDragStart={(event) => startPaletteDrag(event, kind)}
                onDragEnd={finishDrag}
                onClick={() => addFromPalette(kind)}
                aria-label={paletteTarget ? `Add ${KIND_LABELS[kind]} to ${benchLabel(paletteTarget)}` : `Add ${KIND_LABELS[kind]} (select a bench first)`}
                title={KIND_LABELS[kind]}
              >
                {PALETTE_NAMES[kind]}
              </button>
            );
          })}
        </div>
      )}

      {!onAnnounce && <p className="visually-hidden" aria-live="polite" role="status">{announcement}</p>}
    </div>
  );
}
