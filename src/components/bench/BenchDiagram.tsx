import type { BenchProfile } from '../../bench/types';
import { resourceClassOf } from '../../bench/checklist';
import { DEFAULT_COORDINATOR } from '../../bench/profile';

interface Box {
  x: number;
  y: number;
  title: string;
  subtitle?: string;
  kind: 'host' | 'service' | 'device' | 'board';
}

const BOX_W = 168;
const BOX_H = 54;
const GAP_X = 44;
const GAP_Y = 14;
/** 13px bold Barlow fits about 18 characters in a 168px box with 12px padding. */
const TITLE_CHARS = 18;
const SUBTITLE_CHARS = 24;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function BenchDiagram({ profile }: { profile: BenchProfile }) {
  const remote = profile.topology === 'remote';
  const devices = profile.devices.filter((device) => device.kind !== 'unsupported-usb');
  const rows = Math.max(devices.length, 1);
  const height = rows * (BOX_H + GAP_Y) - GAP_Y + 24;
  const centerY = height / 2 - BOX_H / 2;
  const coordinator = profile.names.coordinator.trim() || DEFAULT_COORDINATOR;
  const exporterHost = profile.names.exporterHost.trim() || 'the exporter host';
  const boardName = profile.board.name.trim() || 'the board';

  const columns: Box[][] = [];
  if (remote) {
    columns.push([{ x: 0, y: centerY, title: 'Your computer', subtitle: 'labgrid-client / pytest', kind: 'host' }]);
    columns.push([{ x: 0, y: centerY, title: 'Coordinator', subtitle: truncate(coordinator, SUBTITLE_CHARS), kind: 'service' }]);
    columns.push([{ x: 0, y: centerY, title: 'Exporter', subtitle: truncate(profile.names.exporterHost.trim() || 'exporter host', SUBTITLE_CHARS), kind: 'host' }]);
  } else {
    columns.push([{ x: 0, y: centerY, title: 'This computer', subtitle: 'labgrid environment', kind: 'host' }]);
  }
  columns.push(
    devices.length > 0
      ? devices.map((device, index) => ({
          x: 0,
          y: 12 + index * (BOX_H + GAP_Y),
          title: truncate(device.label || device.kind, TITLE_CHARS),
          subtitle: resourceClassOf(device) ? truncate(resourceClassOf(device) ?? '', SUBTITLE_CHARS) : undefined,
          kind: 'device' as const,
        }))
      : [{ x: 0, y: centerY, title: 'No devices yet', kind: 'device' as const }],
  );
  columns.push([{ x: 0, y: centerY, title: truncate(profile.board.name.trim() || 'Your board', TITLE_CHARS), subtitle: 'device under test', kind: 'board' }]);
  columns.forEach((column, index) => column.forEach((box) => { box.x = index * (BOX_W + GAP_X); }));

  const width = columns.length * BOX_W + (columns.length - 1) * GAP_X;
  const deviceNames = devices.map((device) => device.label).join(', ') || 'no devices';
  const description = remote
    ? `Your computer talks to the coordinator at ${coordinator}, which hands out resources exported by ${exporterHost}: ${deviceNames}; they connect to ${boardName}.`
    : `This computer controls ${deviceNames} connected to ${boardName}.`;

  const arrows: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (let index = 0; index < columns.length - 1; index += 1) {
    const from = columns[index];
    const to = columns[index + 1];
    for (const source of from) {
      for (const target of to) {
        if (from.length > 1 && to.length > 1) continue;
        arrows.push({ x1: source.x + BOX_W, y1: source.y + BOX_H / 2, x2: target.x, y2: target.y + BOX_H / 2 });
      }
    }
  }

  // Keep the drawing at least 80 % of its natural size so labels stay legible on
  // narrow screens; the figure scrolls horizontally instead of shrinking the text.
  const minWidth = Math.round(width * 0.8);

  return (
    <figure className="bench-diagram">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ maxWidth: `${width}px`, minWidth: `${minWidth}px` }}
        role="img"
        aria-label={description}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker id="bench-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0 0 L8 4 L0 8 z" className="diagram-arrowhead" />
          </marker>
        </defs>
        {arrows.map((arrow, index) => (
          <path
            key={index}
            className="diagram-arrow"
            d={`M${arrow.x1} ${arrow.y1} C ${arrow.x1 + GAP_X / 2} ${arrow.y1}, ${arrow.x2 - GAP_X / 2} ${arrow.y2}, ${arrow.x2} ${arrow.y2}`}
            markerEnd="url(#bench-arrow)"
          />
        ))}
        {columns.flat().map((box, index) => (
          <g key={index} className={`diagram-box diagram-${box.kind}`} transform={`translate(${box.x} ${box.y})`}>
            <rect width={BOX_W} height={BOX_H} rx="6" />
            <text x="12" y={box.subtitle ? 23 : 32} className="diagram-title">{box.title}</text>
            {box.subtitle && <text x="12" y="41" className="diagram-subtitle">{box.subtitle}</text>}
          </g>
        ))}
      </svg>
      <figcaption>{remote ? 'Distributed setup: client, coordinator, exporter, devices, board.' : 'Local setup: this computer drives the devices directly.'}</figcaption>
    </figure>
  );
}
