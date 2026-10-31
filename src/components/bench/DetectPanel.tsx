import { useState } from 'react';
import type { BenchDevice, HardwareCatalog } from '../../bench/types';
import type { DetectionResult } from '../../bench/detect';
import { parseHardwareText } from '../../bench/parsers/index';
import { CopyButton, KindBadge } from './shared';

interface Props {
  catalog: HardwareCatalog;
  existing: BenchDevice[];
  onAdd: (devices: BenchDevice[]) => void;
}

const COMMANDS = [
  { command: 'lsusb', note: 'Lists every USB device with its vendor and product id.' },
  { command: 'udevadm info /dev/ttyUSB0', note: 'Shows the serial number and port path of one device.' },
  { command: 'labgrid-suggest', note: 'Prints ready-made Labgrid match blocks while you plug devices in.' },
];

const FORMAT_LABELS = {
  lsusb: 'lsusb output',
  udevadm: 'udevadm info output',
  'labgrid-suggest': 'labgrid-suggest output',
  unknown: 'unrecognized text',
};

export function DetectPanel({ catalog, existing, onAdd }: Props) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<DetectionResult>();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState('');

  function detect(): void {
    const detection = parseHardwareText(text, catalog, existing);
    setResult(detection);
    setStatus('');
    setSelected(new Set(detection.candidates.map((candidate, index) => (candidate.confidence === 'low' ? -1 : index)).filter((index) => index >= 0)));
  }

  function toggle(index: number): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function add(): void {
    if (!result) return;
    const devices = result.candidates.filter((_, index) => selected.has(index)).map(({ device }) => device);
    onAdd(devices);
    setStatus(`Added ${devices.length} ${devices.length === 1 ? 'device' : 'devices'} to your bench.`);
    setText('');
    setResult(undefined);
    setSelected(new Set());
  }

  return (
    <div className="detect-panel">
      <p className="section-copy">
        Run one of these commands on the Linux machine the hardware is plugged into and paste the output here. Nothing leaves your browser.
      </p>
      <ul className="command-chips" aria-label="Detection commands">
        {COMMANDS.map(({ command, note }) => (
          <li key={command}>
            <code>{command}</code>
            <span>{note}</span>
            <CopyButton text={command} compact ariaLabel={`Copy command ${command}`} />
          </li>
        ))}
      </ul>
      <label htmlFor="detect-input">Paste command output</label>
      <textarea
        id="detect-input"
        rows={6}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={'Bus 001 Device 002: ID 10c4:ea60 Silicon Labs CP210x UART Bridge'}
        spellCheck={false}
      />
      <div className="detect-actions">
        <button className="button secondary" type="button" disabled={!text.trim()} onClick={detect}>Detect devices</button>
      </div>

      {result && result.format === 'unknown' && (
        <div className="detect-error" role="alert">
          <strong>That does not look like lsusb, udevadm or labgrid-suggest output.</strong>
          <p>Copy the complete output of one of the commands above, including the <code>Bus … ID</code> lines or the <code>E: KEY=VALUE</code> lines.</p>
        </div>
      )}

      {/* The live region stays mounted so screen readers announce results that appear inside it. */}
      <div className="detect-results-region" aria-live="polite">
        {status && <p className="detect-summary" role="status">{status}</p>}
        {result && result.format !== 'unknown' && (
          <div className="detect-results">
            <p className="detect-summary">
              Recognized {FORMAT_LABELS[result.format]}: {result.candidates.length} {result.candidates.length === 1 ? 'device' : 'devices'} Labgrid can use.
            </p>
            {result.candidates.length > 0 && (
              <ul className="candidate-list" aria-label="Detected devices">
                {result.candidates.map((candidate, index) => (
                  <li key={`${candidate.device.kind}-${index}`} className={`candidate confidence-${candidate.confidence}`}>
                    <label>
                      <input type="checkbox" checked={selected.has(index)} onChange={() => toggle(index)} />
                      <span className="candidate-body">
                        <span className="candidate-title">
                          <KindBadge device={candidate.device} />
                          <strong className="candidate-label">{candidate.device.label}</strong>
                          {candidate.catalogEntry && <span className="candidate-product">{candidate.catalogEntry.vendor} {candidate.catalogEntry.product}</span>}
                          <span className={`confidence confidence-${candidate.confidence}`}>{candidate.confidence} confidence</span>
                        </span>
                        <small>{candidate.explanation}</small>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {result.skipped.length > 0 && (
              <details className="skipped-list">
                <summary>{result.skipped.length} skipped {result.skipped.length === 1 ? 'entry' : 'entries'}</summary>
                <ul>{result.skipped.map((item) => <li key={item.summary}><strong>{item.summary}</strong> {item.reason}</li>)}</ul>
              </details>
            )}
            <div className="detect-actions">
              <button className="button primary" type="button" disabled={selected.size === 0} onClick={add}>
                Add selected devices
              </button>
              {selected.size === 0 && result.candidates.length > 0 && (
                <span className="field-hint">Tick at least one device to add it.</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
