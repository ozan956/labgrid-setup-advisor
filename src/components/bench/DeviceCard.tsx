import type { BenchDevice, HardwareCatalog, UdevMatch } from '../../bench/types';
import { findPduModel, findUsbDevice } from '../../bench/catalog';
import { Field, KIND_LABELS, KindBadge } from './shared';

const MATCH_KEYS = ['ID_SERIAL_SHORT', 'ID_PATH', '@ID_PATH', 'ID_USB_INTERFACE_NUM', '@port_number', 'ID_VENDOR_ID', 'ID_MODEL_ID', '@ID_SERIAL_SHORT'];
const SPEEDS = [9600, 19200, 38400, 57600, 115200, 230400, 921600];

interface Props {
  device: BenchDevice;
  catalog: HardwareCatalog;
  onChange: (device: BenchDevice) => void;
  onRemove: () => void;
}

function MatchEditor({ id, match, onChange }: { id: string; match: UdevMatch; onChange: (match: UdevMatch) => void }) {
  const entries = Object.entries(match);
  const keys = [...new Set([...MATCH_KEYS, ...entries.map(([key]) => key)])];

  function update(index: number, key: string, value: string): void {
    const next: UdevMatch = {};
    entries.forEach(([currentKey, currentValue], position) => {
      if (position === index) {
        if (key in next) return;
        next[key] = value;
      } else if (!(currentKey in next)) {
        next[currentKey] = currentValue;
      }
    });
    onChange(next);
  }

  function add(): void {
    const unused = MATCH_KEYS.find((key) => !(key in match)) ?? `KEY_${entries.length + 1}`;
    onChange({ ...match, [unused]: '' });
  }

  function remove(index: number): void {
    const next: UdevMatch = {};
    entries.forEach(([key, value], position) => {
      if (position !== index) next[key] = value;
    });
    onChange(next);
  }

  return (
    <fieldset className="match-editor">
      <legend>udev match</legend>
      {entries.length === 0 && <p className="field-hint">No match yet. Add a key such as ID_SERIAL_SHORT or ID_PATH.</p>}
      {entries.map(([key, value], index) => (
        <div className="match-row" key={`${index}-${key}`}>
          <label className="visually-hidden" htmlFor={`${id}-match-key-${index}`}>Match key {index + 1}</label>
          <select id={`${id}-match-key-${index}`} value={key} onChange={(event) => update(index, event.target.value, value)}>
            {keys.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <label className="visually-hidden" htmlFor={`${id}-match-value-${index}`}>Match value for {key}</label>
          <input
            id={`${id}-match-value-${index}`}
            value={value}
            placeholder={key.includes('PATH') ? 'pci-0000:00:14.0-usb-0:1.3:1.0' : key === 'ID_USB_INTERFACE_NUM' ? '00' : 'A50285BI'}
            onChange={(event) => update(index, key, event.target.value)}
          />
          <button className="text-button" type="button" onClick={() => remove(index)} aria-label={`Remove match ${key}`}>Remove</button>
        </div>
      ))}
      <button className="text-button" type="button" onClick={add}>+ Add match key</button>
      <small className="field-hint">
        ID_SERIAL_SHORT follows the adapter between ports; ID_PATH follows the USB port. Keys starting with @ are checked on the parent device.
      </small>
    </fieldset>
  );
}

function SpeedSelect({ id, value, onChange }: { id: string; value: number; onChange: (speed: number) => void }) {
  const custom = !SPEEDS.includes(value);
  return (
    <Field id={id} label="Baud rate">
      <div className="inline-fields">
        <select id={id} value={custom ? 'custom' : String(value)} onChange={(event) => onChange(event.target.value === 'custom' ? value : Number(event.target.value))}>
          {SPEEDS.map((speed) => <option key={speed} value={String(speed)}>{speed}</option>)}
          <option value="custom">Custom</option>
        </select>
        {custom && (
          <>
            <label className="visually-hidden" htmlFor={`${id}-custom`}>Custom baud rate</label>
            <input id={`${id}-custom`} type="number" min={1} value={value} onChange={(event) => onChange(Number(event.target.value) || value)} />
          </>
        )}
      </div>
    </Field>
  );
}

export function DeviceCard({ device, catalog, onChange, onRemove }: Props) {
  const id = `device-${device.id}`;
  const usbId = 'usbId' in device ? device.usbId : undefined;
  const usbEntry = usbId ? findUsbDevice(catalog, usbId) : undefined;

  function patch(changes: Partial<BenchDevice>): void {
    onChange({ ...device, ...changes } as BenchDevice);
  }

  return (
    <article className="device-card" aria-label={`${device.label} device`}>
      <header>
        <KindBadge device={device} />
        <span className="device-kind">{KIND_LABELS[device.kind]}</span>
        <button className="text-button danger" type="button" onClick={onRemove}>Remove</button>
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
          <Field id={`${id}-host`} label="Host">
            <input id={`${id}-host`} value={device.host} placeholder="ser2net.lab.example.org" onChange={(event) => patch({ host: event.target.value })} />
          </Field>
          <Field id={`${id}-port`} label="TCP port">
            <input id={`${id}-port`} type="number" min={1} max={65535} value={device.port} onChange={(event) => patch({ port: Number(event.target.value) || 0 })} />
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
            <Field id={`${id}-model`} label="PDU model (Labgrid backend)" hint={model?.notes?.[0]}>
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
              hint={model ? `Outlets count from ${model.indexBase}${model.indexMax !== undefined ? ` to ${model.indexMax}` : ''} for this backend.` : undefined}
            >
              <input id={`${id}-index`} type="number" min={model?.indexBase ?? 0} max={model?.indexMax} value={device.index} onChange={(event) => patch({ index: Number(event.target.value) || 0 })} />
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
            <input id={`${id}-index`} type="number" min={1} max={127} value={device.index} onChange={(event) => patch({ index: Number(event.target.value) || 1 })} />
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
              <input id={`${id}-interface`} list="openocd-interfaces" value={device.interfaceConfig ?? ''} placeholder="interface/stlink.cfg" onChange={(event) => patch({ interfaceConfig: event.target.value || undefined })} />
              <datalist id="openocd-interfaces">
                {[...new Set(catalog.usbDevices.map((entry) => entry.openocdInterface).filter(Boolean))].map((value) => <option key={value} value={value} />)}
              </datalist>
            </Field>
            <Field id={`${id}-board`} label="OpenOCD board config">
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
            <Field id={`${id}-product`} label="USB product id">
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
          <Field id={`${id}-username`} label="Username">
            <input id={`${id}-username`} value={device.username} placeholder="root" onChange={(event) => patch({ username: event.target.value })} />
          </Field>
          <Field id={`${id}-port`} label="SSH port">
            <input id={`${id}-port`} type="number" min={1} max={65535} value={device.port} onChange={(event) => patch({ port: Number(event.target.value) || 22 })} />
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
