import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  MAX_BENCHES,
  addBench,
  applyBenchProfile,
  benchProfile,
  duplicateBench,
  findBench,
  labDeviceCount,
  labErrors,
  moveBench,
  removeBench,
  updateLab,
} from '../../bench/lab';
import { NAME_PATTERN } from '../../bench/profile';
import { validateLabOrProfile } from '../../bench/storage';
import type { BenchProfile, HardwareCatalog, Lab, LabBench } from '../../bench/types';
import { Icon } from '../Icons';
import {
  BoardSection,
  DetectSection,
  DevicesSection,
  LoginSection,
  PlaceSection,
  RESET_CONFIRM_MS,
  TopologyFields,
  describeImportError,
  readFileText,
} from '../bench/BenchEditor';
import { Field, downloadText } from '../bench/shared';

export interface LabEditorProps {
  lab: Lab;
  catalog: HardwareCatalog;
  /** Bench shown in the main panel. Unknown ids fall back to the first bench. */
  activeBenchId: string;
  onChange: (lab: Lab) => void;
  onSelectBench: (benchId: string) => void;
  onPlan: () => void;
  onReset: () => void;
  onExit: () => void;
  /** Interactive lab diagram, mounted above the bench list and the bench panel. */
  /** The interactive diagram; a function receives the editor's announcer so both share one live region. */
  canvas?: ReactNode | ((announce: (text: string) => void) => ReactNode);
  /** Device to highlight in the active bench; when omitted the editor keeps its own selection. */
  selectedDeviceId?: string;
  onSelectDevice?: (benchId: string, deviceId: string) => void;
}

/** DOM id of a device card inside a bench, shared with the canvas for scroll-to. */
export function deviceAnchorId(benchId: string, deviceId: string): string {
  return `bench-${benchId}-device-${deviceId}`;
}

function benchTitle(bench: LabBench): string {
  return bench.board.name.trim() || 'Unnamed board';
}

function plural(count: number, noun: 'bench' | 'device'): string {
  if (count === 1) return `${count} ${noun}`;
  return `${count} ${noun === 'bench' ? 'benches' : 'devices'}`;
}

/** Why the plan button is disabled, or undefined when every name is valid and unique. */
export function planBlocker(lab: Lab, activeBenchId: string): string | undefined {
  for (const [index, bench] of lab.benches.entries()) {
    if (NAME_PATTERN.test(bench.place) && NAME_PATTERN.test(bench.group)) continue;
    return bench.id === activeBenchId ? 'Fix the place or group name first.' : `Fix the place or group name of bench ${index + 1} first.`;
  }
  const [error] = labErrors(lab);
  if (!error) return undefined;
  return error
    .replace(/^place "(.*)" is used by two benches$/, 'Two benches use the place name "$1".')
    .replace(/^exporter group "(.*)" is used by two benches$/, 'Two benches use the exporter group "$1".');
}

export function LabEditor({
  lab,
  catalog,
  activeBenchId,
  onChange,
  onSelectBench,
  onPlan,
  onReset,
  onExit,
  canvas,
  selectedDeviceId,
  onSelectDevice,
}: LabEditorProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const benchHeadingRef = useRef<HTMLHeadingElement>(null);
  const resetTimer = useRef<number>(undefined);
  const removeTimer = useRef<number>(undefined);
  /** Benches whose group the user detached from the place while both were still equal. */
  const [detachedGroups, setDetachedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [internalDeviceId, setInternalDeviceId] = useState<string>();
  const [focusRequest, setFocusRequest] = useState(0);
  /** Device whose highlight came from focusing its card here, so the scroll effect must not steal focus. */
  const focusedHere = useRef<string>(undefined);

  const active = findBench(lab, activeBenchId) ?? lab.benches[0];
  const activeIndex = lab.benches.indexOf(active);
  const profile = benchProfile(lab, active);
  const groupFollowsPlace = !detachedGroups.has(active.id) && active.group === active.place;
  const highlightedDeviceId = selectedDeviceId ?? internalDeviceId;
  const blocker = planBlocker(lab, active.id);
  const manyBenches = lab.benches.length > 1;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => () => {
    window.clearTimeout(resetTimer.current);
    window.clearTimeout(removeTimer.current);
  }, []);

  // Added, duplicated or removed a bench: move focus to the bench panel heading.
  useEffect(() => {
    if (focusRequest > 0) benchHeadingRef.current?.focus();
  }, [focusRequest]);

  // A device picked elsewhere (the canvas) scrolls into view and takes focus.
  useEffect(() => {
    if (!highlightedDeviceId) return;
    if (focusedHere.current === highlightedDeviceId) {
      focusedHere.current = undefined;
      return;
    }
    const element = document.getElementById(deviceAnchorId(active.id, highlightedDeviceId));
    if (!element) return;
    element.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    element.focus({ preventScroll: true });
  }, [highlightedDeviceId, active.id]);

  // Switching benches drops the remove confirmation and the device highlight.
  useEffect(() => {
    setConfirmRemove(false);
    window.clearTimeout(removeTimer.current);
    setInternalDeviceId(undefined);
  }, [active.id]);

  function changeBench(next: BenchProfile): void {
    onChange(applyBenchProfile(lab, active.id, next));
  }

  function changeGroupFollowsPlace(follows: boolean): void {
    setDetachedGroups((current) => {
      const next = new Set(current);
      if (follows) next.delete(active.id);
      else next.add(active.id);
      return next;
    });
  }

  function selectBench(benchId: string): void {
    onSelectBench(benchId);
  }

  /** Editing a card highlights it (and tells the canvas) without moving focus. */
  function focusDevice(deviceId: string): void {
    if (deviceId === highlightedDeviceId) return;
    focusedHere.current = deviceId;
    setInternalDeviceId(deviceId);
    onSelectDevice?.(active.id, deviceId);
  }

  function handleAdd(): void {
    const { lab: next, bench } = addBench(lab);
    onChange(next);
    onSelectBench(bench.id);
    setStatus(`Added bench ${next.benches.length} with place ${bench.place}. Name its board and add its devices.`);
    setFocusRequest((count) => count + 1);
  }

  function handleDuplicate(): void {
    const { lab: next, bench } = duplicateBench(lab, active.id);
    const position = next.benches.indexOf(bench) + 1;
    onChange(next);
    onSelectBench(bench.id);
    setStatus(`Duplicated ${benchTitle(active)} as bench ${position} with place ${bench.place}. The udev match values were cleared; fill them in for the second unit.`);
    setFocusRequest((count) => count + 1);
  }

  function requestRemove(): void {
    if (!confirmRemove) {
      setConfirmRemove(true);
      removeTimer.current = window.setTimeout(() => setConfirmRemove(false), RESET_CONFIRM_MS);
      return;
    }
    window.clearTimeout(removeTimer.current);
    setConfirmRemove(false);
    const next = removeBench(lab, active.id);
    const neighbour = next.benches[Math.min(Math.max(activeIndex - 1, 0), next.benches.length - 1)];
    onChange(next);
    onSelectBench(neighbour.id);
    setStatus(lab.benches.length === 1
      ? `Removed ${benchTitle(active)}; the lab now has one empty bench.`
      : `Removed bench ${activeIndex + 1} (${benchTitle(active)}). ${plural(next.benches.length, 'bench')} left.`);
    setFocusRequest((count) => count + 1);
  }

  function handleMove(delta: -1 | 1): void {
    const target = activeIndex + delta;
    if (target < 0 || target >= lab.benches.length) return;
    onChange(moveBench(lab, active.id, target));
    setStatus(`Moved ${benchTitle(active)} to position ${target + 1} of ${lab.benches.length}.`);
  }

  function requestReset(): void {
    if (confirmReset) {
      window.clearTimeout(resetTimer.current);
      setConfirmReset(false);
      setDetachedGroups(new Set());
      setImportErrors([]);
      setStatus('');
      onReset();
      return;
    }
    setConfirmReset(true);
    resetTimer.current = window.setTimeout(() => setConfirmReset(false), RESET_CONFIRM_MS);
  }

  async function importJson(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setStatus('');
    let text: string;
    try {
      text = await readFileText(file);
    } catch {
      setImportErrors(['The file could not be read.']);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setImportErrors(['The file is not valid JSON.']);
      return;
    }
    const { lab: imported, errors } = validateLabOrProfile(parsed);
    if (!imported) {
      setImportErrors(errors.map(describeImportError));
      return;
    }
    setImportErrors([]);
    setDetachedGroups(new Set());
    onChange(imported);
    onSelectBench(imported.benches[0].id);
    const devices = labDeviceCount(imported);
    setStatus(imported.benches.length === 1
      ? `Imported ${plural(devices, 'device')} for ${benchTitle(imported.benches[0])}.`
      : `Imported a lab with ${plural(imported.benches.length, 'bench')} and ${plural(devices, 'device')}.`);
  }

  function exportJson(): void {
    downloadText('lab-profile.json', JSON.stringify(lab, null, 2), 'application/json');
  }

  return (
    <main id="main-content" className="bench-page lab-page page-shell">
      <div className="wizard-topline">
        <button className="text-button" onClick={onExit}>← Home</button>
        <span>{manyBenches ? 'Describe your lab' : 'Describe your bench'}</span>
      </div>
      <header className="bench-header">
        <div className="section-kicker">Your hardware</div>
        <h1 ref={headingRef} tabIndex={-1}>{manyBenches ? 'Describe your lab' : 'Describe your bench'}</h1>
        <p className="page-intro">
          Tell the advisor what is on your desk. It fills the Labgrid files with your values, warns about the usual traps, and writes a checklist for your setup.
          Several boards on one exporter host form a lab: they share the host and coordinator and each gets its own place.
        </p>
      </header>

      {canvas && (
        <section className="lab-canvas-slot" aria-label="Lab diagram">
          {typeof canvas === 'function' ? canvas(setStatus) : canvas}
        </section>
      )}

      <div className="lab-layout">
        <aside className="lab-rail">
          <section className="bench-section lab-section" aria-labelledby="lab-heading">
            <h2 id="lab-heading">Lab</h2>
            <p className="section-copy">Shared by every bench below.</p>
            <Field id="lab-name" label="Lab name (optional)" hint="Shown in summaries, for example a rack or room.">
              <input id="lab-name" value={lab.name} placeholder="Rack 3" onChange={(event) => onChange(updateLab(lab, { name: event.target.value }))} />
            </Field>
            <TopologyFields
              topology={lab.topology}
              sharing={lab.sharing}
              exporterHost={lab.names.exporterHost}
              coordinator={lab.names.coordinator}
              onChange={(patch) => onChange(updateLab(lab, {
                topology: patch.topology ?? lab.topology,
                sharing: patch.sharing ?? lab.sharing,
                names: {
                  ...lab.names,
                  exporterHost: patch.exporterHost ?? lab.names.exporterHost,
                  coordinator: patch.coordinator ?? lab.names.coordinator,
                },
              }))}
            />
            <Field id="location" label="Location (optional)" hint="Free text shown next to every place, for example a rack or desk.">
              <input id="location" value={lab.names.location} placeholder="Rack 2, shelf 3" onChange={(event) => onChange(updateLab(lab, { names: { ...lab.names, location: event.target.value } }))} />
            </Field>
          </section>

          <nav className="bench-section bench-list" aria-labelledby="bench-list-heading">
            <h2 id="bench-list-heading">Benches ({lab.benches.length})</h2>
            <ol>
              {lab.benches.map((bench, index) => (
                <li key={bench.id}>
                  <button
                    type="button"
                    className={bench.id === active.id ? 'bench-item selected' : 'bench-item'}
                    aria-current={bench.id === active.id ? 'true' : undefined}
                    aria-label={`Bench ${index + 1}: ${benchTitle(bench)}, place ${bench.place.trim() || 'unnamed'}, ${plural(bench.devices.length, 'device')}`}
                    onClick={() => selectBench(bench.id)}
                  >
                    <strong>{benchTitle(bench)}</strong>
                    <small>{bench.place.trim() || 'no place yet'} · {plural(bench.devices.length, 'device')}</small>
                  </button>
                </li>
              ))}
            </ol>
            <button className="button secondary" type="button" onClick={handleAdd} disabled={lab.benches.length >= MAX_BENCHES}>
              Add bench
            </button>
            {lab.benches.length >= MAX_BENCHES && <p className="field-hint">A lab holds at most {MAX_BENCHES} benches.</p>}
          </nav>
        </aside>

        <div className="lab-main">
          <div className="bench-toolbar">
            <h2 ref={benchHeadingRef} tabIndex={-1} id="active-bench-heading">
              Bench {activeIndex + 1}: {benchTitle(active)}
            </h2>
            <div className="bench-toolbar-actions" role="group" aria-label="Actions for this bench">
              <button className="text-button" type="button" onClick={() => handleMove(-1)} disabled={activeIndex === 0} aria-label="Move bench up">↑ Up</button>
              <button className="text-button" type="button" onClick={() => handleMove(1)} disabled={activeIndex === lab.benches.length - 1} aria-label="Move bench down">↓ Down</button>
              <button className="text-button" type="button" onClick={handleDuplicate} disabled={lab.benches.length >= MAX_BENCHES}>Duplicate bench</button>
              <button className="text-button danger" type="button" onClick={requestRemove}>
                {confirmRemove ? 'Really remove?' : 'Remove bench'}
              </button>
            </div>
            <p className="field-hint bench-toolbar-hint">
              Duplicate copies the devices for a second unit of the same board, clears the udev match values and picks the next free place name.
            </p>
          </div>

          <BoardSection profile={profile} catalog={catalog} onChange={changeBench} step="1" />
          <DetectSection profile={profile} catalog={catalog} onChange={changeBench} step="2" />
          <DevicesSection
            profile={profile}
            catalog={catalog}
            onChange={changeBench}
            step="3"
            highlightedDeviceId={highlightedDeviceId}
            deviceAnchor={(deviceId) => deviceAnchorId(active.id, deviceId)}
            onFocusDevice={focusDevice}
          />
          <PlaceSection
            profile={profile}
            onChange={changeBench}
            step="4"
            title="Place and group"
            groupFollowsPlace={groupFollowsPlace}
            onGroupFollowsPlaceChange={changeGroupFollowsPlace}
            showLocation={false}
          />
          <LoginSection profile={profile} catalog={catalog} onChange={changeBench} step="5" />
        </div>
      </div>

      {importErrors.length > 0 && (
        <div className="detect-error" role="alert">
          <strong>The file could not be imported.</strong>
          <ul>{importErrors.map((error) => <li key={error}>{error}</li>)}</ul>
        </div>
      )}

      <div className="bench-actions" role="group" aria-label="Lab actions">
        <div className="bench-actions-secondary">
          <button className="text-button danger" type="button" onClick={requestReset} aria-describedby="reset-status">
            {confirmReset ? 'Really reset?' : 'Reset lab'}
          </button>
          <label className="text-button file-button">
            Import JSON
            <input type="file" accept="application/json,.json" onChange={importJson} />
          </label>
          <button className="text-button" type="button" onClick={exportJson}>
            Export JSON
          </button>
          <span id="reset-status" className="action-status" role="status" aria-live="polite">
            {confirmReset ? 'Click again within 4 seconds to confirm. This clears every bench, device and name.' : status}
          </span>
        </div>
        <div className="bench-actions-primary">
          {blocker && <span className="field-hint" id="plan-blocked">{blocker}</span>}
          <button className="button primary large" type="button" onClick={onPlan} disabled={blocker !== undefined} aria-describedby={blocker ? 'plan-blocked' : undefined}>
            See my plan <Icon name="arrow" />
          </button>
        </div>
      </div>
    </main>
  );
}
