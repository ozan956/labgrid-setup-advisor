import { useState } from 'react';
import type { BenchDevice, HardwareCatalog, UdevMatch } from '../../bench/types';
import { findPduModel, findUsbDevice } from '../../bench/catalog';
import { Field, KIND_LABELS, KindBadge, NumberInput } from './shared';

const MATCH_KEYS = ['ID_SERIAL_SHORT', 'ID_PATH', '@ID_PATH', 'ID_USB_INTERFACE_NUM', '@port_number', 'ID_VENDOR_ID', 'ID_MODEL_ID', '@ID_SERIAL_SHORT'];
const MATCH_KEY_PATTERN = /^@?[A-Za-z_][A-Za-z0-9_]*$/;
const SPEEDS = [9600, 19200, 38400, 57600, 115200, 230400, 921600];
const CUSTOM = '__custom__';

interface Props {
  device: BenchDevice;
  catalog: HardwareCatalog;
  onChange: (device: BenchDevice) => void;
  onRemove: () => void;
  /** Visually mark the card and make it focusable, e.g. after it was picked on the lab canvas. */
  highlighted?: boolean;
  /** DOM id so other views can scroll to and focus this card. */
  anchorId?: string;
  /** Called when the card or one of its controls receives focus. */
  onFocus?: () => void;
}

interface KeyChooserProps {
  id: string;
  index: number;
  value: string;
  used: string[];
  onChange: (key: string) => void;
}

/** A known-key select with a "Custom key…" escape hatch; custom keys are validated before they reach the profile. */
function KeyChooser({ id, index, value, used, onChange }: KeyChooserProps) {
  const [custom, setCustom] = useState(value !== '' && !MATCH_KEYS.includes(value));
  const [text, setText] = useState(custom ? value : '');
  const options = MATCH_KEYS.includes(value) || value === '' ? MATCH_KEYS : [...MATCH_KEYS, value];
  const textValid = MATCH_KEY_PATTERN.test(text) && (text === value || !used.includes(text));

  return (
    <div className="key-chooser">
      <label className="visually-hidden" htmlFor={`${id}-match-key-${index}`}>Match key {index + 1}</label>
      <select
        id={`${id}-match-key-${index}`}
        value={custom ? CUSTOM : value}
        onChange={(event) => {
          if (event.target.value === CUSTOM) {
            setCustom(true);
            setText(MATCH_KEYS.includes(value) ? '' : value);
          } else {
            setCustom(false);
            onChange(event.target.value);
          }
        }}
      >
        {value === '' && <option value="">Choose a key</option>}
        {options.map((option) => (
          <option key={option} value={option} disabled={option !== value && used.includes(option)}>{option}</option>
        ))}
        <option value={CUSTOM}>Custom key…</option>
      </select>
      {custom && (
        <>
          <label className="visually-hidden" htmlFor={`${id}-match-custom-${index}`}>Custom match key {index + 1}</label>
          <input
            id={`${id}-match-custom-${index}`}
            value={text}
            placeholder="ID_MODEL"
            aria-invalid={text !== '' && !textValid ? true : undefined}
            onChange={(event) => {
              const next = event.target.value;
              setText(next);
              if (MATCH_KEY_PATTERN.test(next) && (next === value || !used.includes(next))) onChange(next);
            }}
          />
        </>
      )}
    </div>
  );
}

function MatchEditor({ id, match, onChange }: { id: string; match: UdevMatch; onChange: (match: UdevMatch) => void }) {
  const entries = Object.entries(match);
  const [pending, setPending] = useState<{ value: string } | undefined>();
  const usedKeys = entries.map(([key]) => key);

  function rebuild(mutate: (rows: Array<[string, string]>) => Array<[string, string]>): void {
    const rows = mutate(entries.map(([key, value]) => [key, value] as [string, string]));
    const next: UdevMatch = {};
    for (const [key, value] of rows) next[key] = value;
    onChange(next);
  }

  function rename(index: number, key: string): void {
    if (usedKeys.includes(key) && usedKeys[index] !== key) return;
    rebuild((rows) => rows.map((row, position) => (position === index ? [key, row[1]] : row)));
  }

  function setValue(index: number, value: string): void {
    rebuild((rows) => rows.map((row, position) => (position === index ? [row[0], value] : row)));
  }

  function remove(index: number): void {
    rebuild((rows) => rows.filter((_, position) => position !== index));
  }

  function add(): void {
    const unused = MATCH_KEYS.find((key) => !(key in match));
    if (unused) onChange({ ...match, [unused]: '' });
    else setPending({ value: '' });
  }

  function commitPending(key: string): void {
    if (!pending || !MATCH_KEY_PATTERN.test(key) || key in match) return;
    onChange({ ...match, [key]: pending.value });
    setPending(undefined);
  }

  const placeholderFor = (key: string): string =>
    key.includes('PATH') ? 'pci-0000:00:14.0-usb-0:1.3:1.0' : key === 'ID_USB_INTERFACE_NUM' ? '00' : 'A50285BI';

  return (
    <fieldset className="match-editor">
      <legend>How Labgrid finds this device (udev match)</legend>
      {entries.length === 0 && !pending && <p className="field-hint">No match yet. Add a key such as ID_SERIAL_SHORT or ID_PATH.</p>}
      {entries.map(([key, value], index) => (
        <div className="match-row" key={index}>
          <KeyChooser id={id} index={index} value={key} used={usedKeys} onChange={(next) => rename(index, next)} />
          <label className="visually-hidden" htmlFor={`${id}-match-value-${index}`}>Match value for {key}</label>
          <input
            id={`${id}-match-value-${index}`}
            value={value}
            placeholder={placeholderFor(key)}
            onChange={(event) => setValue(index, event.target.value)}
          />
          <button className="text-button" type="button" onClick={() => remove(index)} aria-label={`Remove match ${key}`}>Remove</button>
        </div>
      ))}
      {pending && (
        <div className="match-row" key="pending">
          <KeyChooser id={id} index={entries.length} value="" used={usedKeys} onChange={commitPending} />
          <label className="visually-hidden" htmlFor={`${id}-match-value-${entries.length}`}>Match value for the new key</label>
          <input
            id={`${id}-match-value-${entries.length}`}
            value={pending.value}
            placeholder="value"
            onChange={(event) => setPending({ value: event.target.value })}
          />
          <button className="text-button" type="button" onClick={() => setPending(undefined)} aria-label="Remove the new match row">Remove</button>
        </div>
      )}
      <button className="text-button" type="button" onClick={add} disabled={pending !== undefined}>+ Add match key</button>
      <small className="field-hint">
        ID_SERIAL_SHORT follows the adapter between ports; ID_PATH follows the USB port. Keys starting with @ are checked on the parent device.
      </small>
    </fieldset>
  );
}

function SpeedSelect({ id, value, onChange }: { id: string; value: number; onChange: (speed: number) => void }) {
  const [custom, setCustom] = useState(!SPEEDS.includes(value));
  return (
    <Field id={id} label="Baud rate" hint={custom ? 'Whole number of bits per second, for example 1500000.' : undefined}>
      <div className="inline-fields">
        <select
          id={id}
          value={custom ? CUSTOM : String(value)}
          onChange={(event) => {
            if (event.target.value === CUSTOM) {
              setCustom(true);
            } else {
              setCustom(false);
              onChange(Number(event.target.value));
            }
          }}
        >
          {SPEEDS.map((speed) => <option key={speed} value={String(speed)}>{speed}</option>)}
          <option value={CUSTOM}>Custom</option>
        </select>
        {custom && (
          <NumberInput id={`${id}-custom`} value={value} min={1} onCommit={onChange} aria-label="Custom baud rate" />
        )}
      </div>
    </Field>
  );
}

export function DeviceCard({ device, catalog, onChange, onRemove, highlighted = false, anchorId, onFocus }: Props) {
  const id = `device-${device.id}`;
  const usbId = 'usbId' in device ? device.usbId : undefined;
  const usbEntry = usbId ? findUsbDevice(catalog, usbId) : undefined;

  function patch(changes: Partial<BenchDevice>): void {
    onChange({ ...device, ...changes } as BenchDevice);
  }

  return (
    <article className={highlighted ? 'device-card highlighted' : 'device-card'} id={anchorId} tabIndex={anchorId ? -1 : undefined} onFocus={onFocus} aria-label={`${device.label} device`}>
      <header>
        <KindBadge device={device} />
        <span className="device-kind">{KIND_LABELS[device.kind]}</span>
        <button className="text-button danger" type="button" onClick={onRemove} aria-label={`Remove ${device.label}`}>Remove</button>
      </header>
      {device.kind !== 'unsupported-usb' && (
        <Field id={`${id}-label`} label="Label" hint="Used for resource names in the generated files.">
          <input id={`${id}-label`} value={device.label} onChange={(event) => patch({ label: event.target.value })} />
        </Field>
      )}
      {usbEntry && usbId && <p className="device-note">{usbEntry.vendor} {usbEntry.product} ({usbId.vendorId}:{usbId.productId})</p>}
      {device.note && !usbEntry && <p className="device-note">{device.note}</p>}

      {device.kind === 'usb-serial' && (
        <>
          <MatchEditor id={id} match={device.match} onChange={(match) => patch({ match })} />
          <SpeedSelect id={`${id}-speed`} value={device.speed} onChange={(speed) => patch({ speed })} />
          {usbEntry?.serialNumber && (usbEntry.serialNumber === 'shared' || usbEntry.serialNumber === 'none') && (
            <p className="device-note warning-text">This chip usually has no unique serial number. Match on ID_PATH and keep the adapter in the same USB port.</p>
          )}
        </>
      )}

      {device.kind === 'network-serial' && (
        <div className="field-grid">
          <Field id={`${id}-host`} label="Host" hint="Hostname or IP address of the serial server (for example a ser2net host).">
            <input id={`${id}-host`} value={device.host} placeholder="ser2net.lab.example.org" onChange={(event) => patch({ host: event.target.value })} />
          </Field>
          <Field id={`${id}-port`} label="TCP port" hint="1 to 65535.">
            <NumberInput id={`${id}-port`} value={device.port} min={1} max={65535} onCommit={(port) => patch({ port })} />
          </Field>
          <SpeedSelect id={`${id}-speed`} value={device.speed} onChange={(speed) => patch({ speed })} />
          <fieldset className="radio-group">
            <legend>Protocol</legend>
            {(['rfc2217', 'raw'] as const).map((protocol) => (
              <label key={protocol}>
                <input type="radio" name={`${id}-protocol`} checked={device.protocol === protocol} onChange={() => patch({ protocol })} />
                {protocol === 'raw' ? 'Raw TCP' : 'RFC 2217'}
              </label>
            ))}
          </fieldset>
        </div>
      )}

      {device.kind === 'network-pdu' && (() => {
        const model = findPduModel(catalog, device.model);
        const models = [...catalog.pduModels].sort((a, b) => a.family.localeCompare(b.family));
        return (
          <div className="field-grid">
            <Field id={`${id}-model`} label="PDU model (Labgrid backend)" hint={model?.notes?.[0] ?? 'The model name selects the Labgrid power backend.'}>
              <select id={`${id}-model`} value={device.model} onChange={(event) => patch({ model: event.target.value })}>
                {!model && <option value={device.model}>{device.model || 'Choose a model'}</option>}
                {models.map((entry) => <option key={entry.model} value={entry.model}>{entry.family} ({entry.model})</option>)}
              </select>
            </Field>
            <Field
              id={`${id}-host`}
              label={model?.hostFormat === 'url' ? 'URL' : 'Host'}
              hint={model?.hostFormat === 'url' ? 'This backend expects a full URL such as http://192.168.0.42' : 'Hostname or IP address of the PDU.'}
            >
              <input id={`${id}-host`} value={device.host} placeholder={model?.hostFormat === 'url' ? 'http://192.168.0.42' : 'pdu-01.lab.example.org'} onChange={(event) => patch({ host: event.target.value })} />
            </Field>
            <Field
              id={`${id}-index`}
              label="Outlet index"
              hint={model ? `Outlets count from ${model.indexBase}${model.indexMax !== undefined ? ` to ${model.indexMax}` : ''} for this backend.` : 'The outlet number as the backend counts it.'}
            >
              <NumberInput id={`${id}-index`} value={device.index} min={model?.indexBase ?? 0} max={model?.indexMax} onCommit={(index) => patch({ index })} />
            </Field>
          </div>
        );
      })()}

      {device.kind === 'ykush' && (
        <div className="field-grid">
          <Field id={`${id}-serial`} label="YKUSH serial" hint="Printed by ykushcmd ykush3 -l (or ykushcmd -l for the original YKUSH).">
            <input id={`${id}-serial`} value={device.serial} placeholder="Y3N12345" onChange={(event) => patch({ serial: event.target.value })} />
          </Field>
          <Field id={`${id}-index`} label="Downstream port" hint="Use a to switch every port at once.">
            <select id={`${id}-index`} value={device.index} onChange={(event) => patch({ index: event.target.value })}>
              {['1', '2', '3', 'a'].map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </Field>
        </div>
      )}

      {device.kind === 'usb-hub-port' && (
        <>
          <MatchEditor id={id} match={device.match} onChange={(match) => patch({ match })} />
          <Field id={`${id}-index`} label="Hub port number" hint="The downstream port as shown by uhubctl. ID_PATH must point at the hub interface and usually ends with :1.0.">
            <NumberInput id={`${id}-index`} value={device.index} min={1} max={127} onCommit={(index) => patch({ index })} />
          </Field>
        </>
      )}

      {device.kind === 'manual-power' && (
        <p className="device-note">Labgrid will ask you to switch power by hand when a test needs it. Add a YKUSH, a uhubctl-capable hub or a PDU later.</p>
      )}

      {device.kind === 'usb-debugger' && (
        <>
          <MatchEditor id={id} match={device.match} onChange={(match) => patch({ match })} />
          <div className="field-grid">
            <Field id={`${id}-interface`} label="OpenOCD interface config" hint="Relative to the OpenOCD scripts directory.">
              <input id={`${id}-interface`} list={`${id}-openocd-interfaces`} value={device.interfaceConfig ?? ''} placeholder="interface/stlink.cfg" onChange={(event) => patch({ interfaceConfig: event.target.value || undefined })} />
              <datalist id={`${id}-openocd-interfaces`}>
                {[...new Set(catalog.usbDevices.map((entry) => entry.openocdInterface).filter(Boolean))].map((value) => <option key={value} value={value} />)}
              </datalist>
            </Field>
            <Field id={`${id}-board`} label="OpenOCD board config" hint="Optional board script, also relative to the scripts directory.">
              <input id={`${id}-board`} value={device.boardConfig ?? ''} placeholder="board/st_nucleo_f4.cfg" onChange={(event) => patch({ boardConfig: event.target.value || undefined })} />
            </Field>
          </div>
        </>
      )}

      {(device.kind === 'dfu' || device.kind === 'usb-sd-mux' || device.kind === 'usb-storage' || device.kind === 'imx-usb-loader') && (
        <MatchEditor id={id} match={device.match} onChange={(match) => patch({ match })} />
      )}

      {device.kind === 'fastboot' && (
        <>
          <MatchEditor id={id} match={device.match} onChange={(match) => patch({ match })} />
          <div className="field-grid">
            <Field id={`${id}-vendor`} label="USB vendor id" hint="Four hex digits as shown by lsusb.">
              <input id={`${id}-vendor`} value={device.usbId.vendorId} onChange={(event) => patch({ usbId: { ...device.usbId, vendorId: event.target.value.toLowerCase() } })} />
            </Field>
            <Field id={`${id}-product`} label="USB product id" hint="Four hex digits as shown by lsusb.">
              <input id={`${id}-product`} value={device.usbId.productId} onChange={(event) => patch({ usbId: { ...device.usbId, productId: event.target.value.toLowerCase() } })} />
            </Field>
          </div>
        </>
      )}

      {device.kind === 'network-service' && (
        <div className="field-grid">
          <Field id={`${id}-address`} label="Address" hint="Hostname or IP address of the board.">
            <input id={`${id}-address`} value={device.address} placeholder="192.168.1.50" onChange={(event) => patch({ address: event.target.value })} />
          </Field>
          <Field id={`${id}-username`} label="Username" hint="The Linux user Labgrid logs in as over SSH.">
            <input id={`${id}-username`} value={device.username} placeholder="root" onChange={(event) => patch({ username: event.target.value })} />
          </Field>
          <Field id={`${id}-port`} label="SSH port" hint="Usually 22.">
            <NumberInput id={`${id}-port`} value={device.port} min={1} max={65535} onCommit={(port) => patch({ port })} />
          </Field>
        </div>
      )}

      {device.kind === 'unsupported-usb' && (
        <p className="device-note">
          {device.label} ({device.usbId.vendorId}:{device.usbId.productId}). Labgrid has no resource for this device, so it is left out of the generated files.
        </p>
      )}
    </article>
  );
}
