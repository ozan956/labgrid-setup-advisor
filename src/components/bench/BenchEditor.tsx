import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { BenchDevice, BenchProfile, BoardPreset, BoardVerification, DeviceKind, HardwareCatalog } from '../../bench/types';
import { findBoard, searchBoards } from '../../bench/catalog';
import { ADDABLE_KINDS, DEFAULT_COORDINATOR, NAME_PATTERN, blankDevice, nextDeviceId } from '../../bench/profile';
import { validateProfile } from '../../bench/storage';
import { Icon } from '../Icons';
import { DetectPanel } from './DetectPanel';
import { DeviceCard } from './DeviceCard';
import { Field, KIND_LABELS, downloadText } from './shared';

interface Props {
  profile: BenchProfile;
  catalog: HardwareCatalog;
  onChange: (profile: BenchProfile) => void;
  onPlan: () => void;
  onReset: () => void;
  onExit: () => void;
}

const DEFAULT_LOGIN = { username: 'root', loginPrompt: ' login: ', prompt: 'root@[\\w-]+:[^ ]+ ' };
const BOOTLOADER_PROMPTS = { uboot: '=> ', barebox: 'barebox@[^:]+:[^ ]+ ' };
const RESET_CONFIRM_MS = 4000;

/** Plain wording for how a preset's facts were confirmed. */
export const VERIFICATION_LABELS: Record<BoardVerification, string> = {
  lab: 'Verified on hardware',
  docs: 'From documentation',
  unverified: 'Imported, not yet reviewed',
};

const VERIFICATION_OPTION_SUFFIX: Record<BoardVerification, string> = {
  lab: 'verified on hardware',
  docs: 'from documentation',
  unverified: 'not yet reviewed',
};

/** FileReader works in every browser and in jsdom; Blob.text() is not available everywhere. */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsText(file);
  });
}

function describeImportError(error: string): string {
  // Ajv messages look like "/devices/0/kind must be equal to one of the allowed values".
  const match = /^(\/\S*)\s+(.*)$/.exec(error);
  if (match) return `In the file, ${match[1] === '/' ? 'the top level' : match[1].replace(/^\//, '').replace(/\//g, ' › ')} ${match[2]}.`;
  return error.endsWith('.') ? error : `${error}.`;
}

function PresetFacts({ preset, onApply }: { preset: BoardPreset; onApply: () => void }) {
  return (
    <aside className="preset-facts" aria-label={`${preset.name} facts`}>
      <div className="preset-heading">
        <h3>{preset.name}</h3>
        <span className={`verification-badge verification-${preset.verification}`}>{VERIFICATION_LABELS[preset.verification]}</span>
      </div>
      {preset.verification === 'unverified' && (
        <p className="verification-hint">
          These facts were imported from source trees and nobody has reviewed them yet; confirm the console speed and the bootloader prompt against your board before relying on them.
        </p>
      )}
      <dl>
        <dt>Console</dt>
        <dd>
          {preset.console.interface === 'none' ? 'No serial console.' : `${preset.console.speed} baud, ${preset.console.interface.replace('-', ' ')}${preset.console.chip ? ` (${preset.console.chip})` : ''}.`}
          {preset.console.note && ` ${preset.console.note}`}
        </dd>
        <dt>Power</dt>
        <dd>{preset.power.inputs.join(', ')}{preset.power.note ? `. ${preset.power.note}` : ''}</dd>
        {preset.bootloader && (
          <>
            <dt>Bootloader</dt>
            <dd>{preset.bootloader.kind === 'none' ? 'None by default.' : `${preset.bootloader.kind === 'uboot' ? 'U-Boot' : 'barebox'}${preset.bootloader.prompt ? `, prompt ${JSON.stringify(preset.bootloader.prompt)}` : ''}.`}{preset.bootloader.note ? ` ${preset.bootloader.note}` : ''}</dd>
          </>
        )}
        {preset.flashing && preset.flashing.length > 0 && (
          <>
            <dt>Flashing</dt>
            <dd>{preset.flashing.join(', ')}</dd>
          </>
        )}
      </dl>
      {preset.notes && preset.notes.length > 0 && <ul>{preset.notes.map((note) => <li key={note}>{note}</li>)}</ul>}
      {preset.docs && preset.docs.length > 0 && (
        <p className="preset-docs">{preset.docs.map((doc) => <a key={doc.url} href={doc.url} target="_blank" rel="noreferrer">{doc.title} ↗</a>)}</p>
      )}
      {preset.sources && preset.sources.length > 0 && (
        <p className="preset-sources"><span>Sources:</span>{preset.sources.map((source) => <code key={source}>{source}</code>)}</p>
      )}
      <button className="button secondary" type="button" onClick={onApply}>Apply preset defaults</button>
    </aside>
  );
}

export function BenchEditor({ profile, catalog, onChange, onPlan, onReset, onExit }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resetTimer = useRef<number>(undefined);
  const [groupFollowsPlace, setGroupFollowsPlace] = useState(profile.names.group === profile.names.place);
  const [confirmReset, setConfirmReset] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importStatus, setImportStatus] = useState('');
  const [addKind, setAddKind] = useState<DeviceKind>('usb-serial');
  const boards = searchBoards(catalog, '');
  const preset = profile.board.presetId ? findBoard(catalog, profile.board.presetId) : undefined;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  function update(changes: Partial<BenchProfile>): void {
    onChange({ ...profile, ...changes });
  }

  function updateNames(changes: Partial<BenchProfile['names']>): void {
    const names = { ...profile.names, ...changes };
    if (groupFollowsPlace && changes.place !== undefined) names.group = changes.place;
    update({ names });
  }

  function chooseBoardName(name: string): void {
    const match = boards.find((board) => board.name.toLowerCase() === name.trim().toLowerCase());
    update({ board: { name, presetId: match?.id } });
  }

  function choosePreset(id: string): void {
    const board = findBoard(catalog, id);
    update({ board: board ? { name: board.name, presetId: board.id } : { name: profile.board.name } });
  }

  function applyPreset(): void {
    if (!preset) return;
    const devices = profile.devices.map((device) =>
      device.kind === 'usb-serial' || device.kind === 'network-serial' ? { ...device, speed: preset.console.speed } : device,
    );
    const bootloader = preset.bootloader && preset.bootloader.kind !== 'none'
      ? { kind: preset.bootloader.kind, prompt: preset.bootloader.prompt ?? BOOTLOADER_PROMPTS[preset.bootloader.kind] }
      : profile.bootloader;
    update({ devices, bootloader });
  }

  function addDevices(devices: BenchDevice[]): void {
    let next = profile;
    for (const device of devices) {
      next = { ...next, devices: [...next.devices, { ...device, id: nextDeviceId(next) }] };
    }
    onChange(next);
  }

  function replaceDevice(index: number, device: BenchDevice): void {
    update({ devices: profile.devices.map((current, position) => (position === index ? device : current)) });
  }

  function removeDevice(index: number): void {
    update({ devices: profile.devices.filter((_, position) => position !== index) });
  }

  function toggleLogin(enabled: boolean): void {
    update({ login: enabled ? { ...DEFAULT_LOGIN } : undefined });
  }

  function chooseBootloader(kind: 'none' | 'uboot' | 'barebox'): void {
    if (kind === 'none') {
      update({ bootloader: undefined });
      return;
    }
    const prompt = preset?.bootloader?.kind === kind && preset.bootloader.prompt ? preset.bootloader.prompt : BOOTLOADER_PROMPTS[kind];
    update({ bootloader: { kind, prompt } });
  }

  function requestReset(): void {
    if (confirmReset) {
      window.clearTimeout(resetTimer.current);
      setConfirmReset(false);
      setGroupFollowsPlace(true);
      setImportErrors([]);
      setImportStatus('');
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
    setImportStatus('');
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
    const { profile: imported, errors } = validateProfile(parsed);
    if (imported) {
      setImportErrors([]);
      setGroupFollowsPlace(imported.names.group === imported.names.place);
      onChange(imported);
      setImportStatus(`Imported ${imported.devices.length} ${imported.devices.length === 1 ? 'device' : 'devices'} for ${imported.board.name.trim() || 'an unnamed board'}.`);
    } else {
      setImportErrors(errors.map(describeImportError));
    }
  }

  const placeValid = NAME_PATTERN.test(profile.names.place);
  const groupValid = NAME_PATTERN.test(profile.names.group);
  const canPlan = placeValid && groupValid;

  return (
    <main id="main-content" className="bench-page page-shell">
      <div className="wizard-topline">
        <button className="text-button" onClick={onExit}>← Home</button>
        <span>Describe your bench</span>
      </div>
      <header className="bench-header">
        <div className="section-kicker">Your hardware</div>
        <h1 ref={headingRef} tabIndex={-1}>Describe your bench</h1>
        <p className="page-intro">
          Tell the advisor what is on your desk. It fills the Labgrid files with your values, warns about the usual traps, and writes a checklist for your setup.
        </p>
      </header>

      <section className="bench-section" aria-labelledby="bench-board-heading">
        <h2 id="bench-board-heading">1. Your board</h2>
        <div className="field-grid">
          <Field id="board-name" label="Board name" hint="Free text. Known boards unlock console, power and bootloader hints.">
            <input id="board-name" list="board-names" value={profile.board.name} placeholder="Raspberry Pi 4" onChange={(event) => chooseBoardName(event.target.value)} />
            <datalist id="board-names">{boards.map((board) => <option key={board.id} value={board.name} />)}</datalist>
          </Field>
          <Field id="board-preset" label="Known boards" hint="Picking a board fills the name and shows what the advisor knows about it.">
            <select id="board-preset" value={profile.board.presetId ?? ''} onChange={(event) => choosePreset(event.target.value)}>
              <option value="">Not in the list</option>
              {[...new Set(boards.map((board) => board.vendor))].map((vendor) => (
                <optgroup key={vendor} label={vendor}>
                  {boards.filter((board) => board.vendor === vendor).map((board) => (
                    <option key={board.id} value={board.id}>{board.name} ({VERIFICATION_OPTION_SUFFIX[board.verification]})</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
        </div>
        {preset && <PresetFacts preset={preset} onApply={applyPreset} />}
      </section>

      <section className="bench-section" aria-labelledby="bench-detect-heading">
        <h2 id="bench-detect-heading">2. Detect what is plugged in</h2>
        <DetectPanel catalog={catalog} existing={profile.devices} onAdd={addDevices} />
      </section>

      <section className="bench-section" aria-labelledby="bench-devices-heading">
        <h2 id="bench-devices-heading">3. Devices ({profile.devices.length})</h2>
        {profile.devices.length === 0 && (
          <p className="section-copy">No devices yet. Paste command output above or add one by hand.</p>
        )}
        <div className="device-list">
          {profile.devices.map((device, index) => (
            <DeviceCard
              key={device.id}
              device={device}
              catalog={catalog}
              onChange={(next) => replaceDevice(index, next)}
              onRemove={() => removeDevice(index)}
            />
          ))}
        </div>
        <div className="add-device">
          <label htmlFor="add-device-kind">Add a device</label>
          <select id="add-device-kind" value={addKind} onChange={(event) => setAddKind(event.target.value as DeviceKind)}>
            {ADDABLE_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
          </select>
          <button className="button secondary" type="button" onClick={() => addDevices([blankDevice(addKind, 'pending')])}>Add</button>
        </div>
      </section>

      <section className="bench-section" aria-labelledby="bench-topology-heading">
        <h2 id="bench-topology-heading">4. Where Labgrid runs</h2>
        <fieldset className="radio-group stacked">
          <legend>Topology</legend>
          <label>
            <input type="radio" name="topology" checked={profile.topology === 'local'} onChange={() => update({ topology: 'local' })} />
            <span><strong>This computer is plugged into the board</strong><small>One environment file; no coordinator or exporter needed.</small></span>
          </label>
          <label>
            <input type="radio" name="topology" checked={profile.topology === 'remote'} onChange={() => update({ topology: 'remote' })} />
            <span><strong>Another Linux machine is plugged into the board; I connect over the network</strong><small>That machine runs labgrid-exporter, a coordinator hands out the board as a place.</small></span>
          </label>
        </fieldset>
        {profile.topology === 'remote' && (
          <div className="field-grid">
            <Field id="exporter-host" label="Exporter host name" hint="Used as the exporter name; it becomes part of every resource path.">
              <input id="exporter-host" value={profile.names.exporterHost} placeholder="lab-exporter-1" onChange={(event) => updateNames({ exporterHost: event.target.value })} />
            </Field>
            <Field id="coordinator" label="Coordinator address" hint={`HOST[:PORT]. The default ${DEFAULT_COORDINATOR} means the coordinator runs on the same machine as the client.`}>
              <input id="coordinator" value={profile.names.coordinator} placeholder={DEFAULT_COORDINATOR} onChange={(event) => updateNames({ coordinator: event.target.value })} />
            </Field>
            <fieldset className="radio-group">
              <legend>Who uses it</legend>
              <label><input type="radio" name="sharing" checked={profile.sharing === 'solo'} onChange={() => update({ sharing: 'solo' })} />Just me</label>
              <label><input type="radio" name="sharing" checked={profile.sharing === 'team'} onChange={() => update({ sharing: 'team' })} />Several people or CI</label>
            </fieldset>
          </div>
        )}
        <div className="field-grid">
          <Field id="place-name" label="Place name" hint="Letters, digits, '-', '_' and '.' only. The name you will pass to labgrid-client -p.">
            <input id="place-name" value={profile.names.place} aria-invalid={!placeValid} onChange={(event) => updateNames({ place: event.target.value })} />
            {!placeValid && (
              <small className="field-error" role="alert">
                {profile.names.place.trim() === '' ? 'A place name is required.' : "Use letters, digits, '-', '_' or '.' only."}
              </small>
            )}
          </Field>
          <Field id="group-name" label="Exporter group" hint="Groups the resources of one board in exporter.yaml.">
            <input id="group-name" value={profile.names.group} disabled={groupFollowsPlace} aria-invalid={!groupValid} onChange={(event) => updateNames({ group: event.target.value })} />
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={groupFollowsPlace}
                onChange={(event) => {
                  setGroupFollowsPlace(event.target.checked);
                  if (event.target.checked) updateNames({ group: profile.names.place });
                }}
              />
              Same as place
            </label>
            {!groupValid && !groupFollowsPlace && (
              <small className="field-error" role="alert">
                {profile.names.group.trim() === '' ? 'A group name is required.' : "Use letters, digits, '-', '_' or '.' only."}
              </small>
            )}
          </Field>
          <Field id="location" label="Location (optional)" hint="Free text shown next to the place, for example a rack or desk.">
            <input id="location" value={profile.names.location} placeholder="Rack 2, shelf 3" onChange={(event) => updateNames({ location: event.target.value })} />
          </Field>
        </div>
      </section>

      <section className="bench-section" aria-labelledby="bench-login-heading">
        <h2 id="bench-login-heading">5. Login and boot (optional)</h2>
        <label className="checkbox-inline large">
          <input type="checkbox" checked={profile.login !== undefined} onChange={(event) => toggleLogin(event.target.checked)} />
          The board runs Linux and Labgrid should log in
        </label>
        {profile.login && (
          <div className="field-grid">
            <Field id="login-username" label="Username" hint="The Linux user Labgrid logs in as.">
              <input id="login-username" value={profile.login.username} onChange={(event) => update({ login: { ...profile.login!, username: event.target.value } })} />
            </Field>
            <Field id="login-prompt" label="Login prompt" hint="Text printed before the username is asked.">
              <input id="login-prompt" value={profile.login.loginPrompt} onChange={(event) => update({ login: { ...profile.login!, loginPrompt: event.target.value } })} />
            </Field>
            <Field id="shell-prompt" label="Shell prompt (regular expression)" hint="Must match the prompt exactly, including the trailing space.">
              <input id="shell-prompt" value={profile.login.prompt} onChange={(event) => update({ login: { ...profile.login!, prompt: event.target.value } })} />
            </Field>
          </div>
        )}
        <div className="field-grid">
          <Field id="bootloader-kind" label="Bootloader" hint="Needed when tests should stop in U-Boot or barebox before Linux boots.">
            <select id="bootloader-kind" value={profile.bootloader?.kind ?? 'none'} onChange={(event) => chooseBootloader(event.target.value as 'none' | 'uboot' | 'barebox')}>
              <option value="none">None or not needed</option>
              <option value="uboot">U-Boot</option>
              <option value="barebox">barebox</option>
            </select>
          </Field>
          {profile.bootloader && (
            <Field id="bootloader-prompt" label="Bootloader prompt (regular expression)" hint="Copy it from a boot log; it is the text shown when autoboot is interrupted.">
              <input id="bootloader-prompt" value={profile.bootloader.prompt} onChange={(event) => update({ bootloader: { ...profile.bootloader!, prompt: event.target.value } })} />
            </Field>
          )}
        </div>
      </section>

      {importErrors.length > 0 && (
        <div className="detect-error" role="alert">
          <strong>The file could not be imported.</strong>
          <ul>{importErrors.map((error) => <li key={error}>{error}</li>)}</ul>
        </div>
      )}

      <div className="bench-actions" role="group" aria-label="Bench actions">
        <div className="bench-actions-secondary">
          <button className="text-button danger" type="button" onClick={requestReset} aria-describedby="reset-status">
            {confirmReset ? 'Really reset?' : 'Reset bench'}
          </button>
          <label className="text-button file-button">
            Import JSON
            <input type="file" accept="application/json,.json" onChange={importJson} />
          </label>
          <button className="text-button" type="button" onClick={() => downloadText('bench-profile.json', JSON.stringify(profile, null, 2), 'application/json')}>
            Export JSON
          </button>
          <span id="reset-status" className="action-status" role="status" aria-live="polite">
            {confirmReset ? 'Click again within 4 seconds to confirm. This clears every device and name.' : importStatus}
          </span>
        </div>
        <div className="bench-actions-primary">
          {!canPlan && <span className="field-hint" id="plan-blocked">Fix the place or group name first.</span>}
          <button className="button primary large" type="button" onClick={onPlan} disabled={!canPlan} aria-describedby={canPlan ? undefined : 'plan-blocked'}>
            See my plan <Icon name="arrow" />
          </button>
        </div>
      </div>
    </main>
  );
}
