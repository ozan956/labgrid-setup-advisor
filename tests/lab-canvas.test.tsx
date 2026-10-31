import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hardwareCatalog } from '../src/bench/catalog';
import { addBench, addDevice, labFromProfile, updateLab } from '../src/bench/lab';
import { emptyProfile } from '../src/bench/profile';
import type { BenchProfile, Lab } from '../src/bench/types';
import { DEVICE_MIME, KIND_MIME, LabCanvas, benchLabel } from '../src/components/lab/LabCanvas';

function piProfile(): BenchProfile {
  return {
    ...emptyProfile(),
    board: { name: 'Raspberry Pi 4 Model B', presetId: 'raspberry-pi-4' },
    topology: 'remote',
    names: { place: 'board-01', group: 'board-01', exporterHost: 'bench-pc', coordinator: 'coordinator.lab:20408', location: '' },
    devices: [
      { id: 'dev-1', label: 'Console', kind: 'usb-serial', usbId: { vendorId: '10c4', productId: 'ea60' }, match: { ID_PATH: 'pci-0000:00:14.0-usb-0:1.3:1.0' }, speed: 115200 },
      { id: 'dev-2', label: 'PDU', kind: 'network-pdu', model: 'netio', host: 'netio1', index: 1 },
    ],
  };
}

/** bench-1 (board-01: Console, PDU) and bench-2 (board-02: ST-LINK as dev-1). */
function twoBenchLab(): Lab {
  const { lab } = addBench(labFromProfile(piProfile()), { name: 'STM32 Nucleo-64', presetId: 'stm32-nucleo-64' });
  return addDevice(lab, 'bench-2', { id: 'dev-1', label: 'ST-LINK', kind: 'usb-serial', match: { ID_SERIAL_SHORT: '0670FF' }, speed: 115200 });
}

/** Minimal DataTransfer stand-in; jsdom has none. */
function dataTransfer() {
  const data: Record<string, string> = {};
  return {
    data,
    effectAllowed: 'uninitialized',
    dropEffect: 'none',
    get types() { return Object.keys(data); },
    setData(key: string, value: string) { data[key] = value; },
    getData(key: string) { return data[key] ?? ''; },
  };
}

function tile(place: string) {
  return screen.getByRole('region', { name: new RegExp(`^Bench ${place}:`) });
}

function brick(label: string, place: string) {
  return screen.getByRole('group', { name: `${label} on ${place}` });
}

function labels(lab: Lab, benchId: string): string[] {
  return lab.benches.find((bench) => bench.id === benchId)!.devices.map((device) => device.label);
}

function ids(lab: Lab, benchId: string): string[] {
  return lab.benches.find((bench) => bench.id === benchId)!.devices.map((device) => device.id);
}

describe('lab canvas', () => {
  beforeEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the host chain and one tile per bench with bricks and board blocks', () => {
    render(<LabCanvas lab={twoBenchLab()} catalog={hardwareCatalog} />);
    expect(screen.getByText('Your computer')).toBeInTheDocument();
    expect(screen.getByText('Coordinator')).toBeInTheDocument();
    expect(screen.getByText('coordinator.lab:20408')).toBeInTheDocument();
    expect(screen.getByText('bench-pc')).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: /^Bench / })).toHaveLength(2);
    const first = tile('board-01');
    expect(within(first).getByRole('button', { name: /^Console: USB-to-serial adapter/ })).toBeInTheDocument();
    expect(within(first).getByRole('button', { name: /^PDU: Network PDU outlet, NetworkPowerPort/ })).toBeInTheDocument();
    expect(within(first).getByRole('button', { name: 'Board Raspberry Pi 4 Model B, place board-01' })).toBeInTheDocument();
    expect(within(first).getByText('From documentation')).toBeInTheDocument();
    expect(first).toHaveAttribute('data-network', 'true');
    expect(tile('board-02')).toHaveAttribute('data-network', 'false');
    expect(screen.getByRole('group', { name: /^Lab diagram: your computer talks to the coordinator at coordinator\.lab:20408/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add bench' })).toBeInTheDocument();
  });

  it('describes a local lab without coordinator or exporter blocks', () => {
    const lab = updateLab(labFromProfile(piProfile()), { topology: 'local' });
    render(<LabCanvas lab={lab} catalog={hardwareCatalog} />);
    expect(screen.getByText('This computer')).toBeInTheDocument();
    expect(screen.queryByText('Coordinator')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: /^Lab diagram: this computer drives 1 bench directly/ })).toBeInTheDocument();
  });

  it('moves a brick to another bench by drag and drop, renaming it on collision', () => {
    const onChange = vi.fn();
    const onSelectDevice = vi.fn();
    render(<LabCanvas lab={twoBenchLab()} catalog={hardwareCatalog} onChange={onChange} onSelectDevice={onSelectDevice} />);
    const transfer = dataTransfer();
    fireEvent.dragStart(brick('Console', 'board-01'), { dataTransfer: transfer });
    expect(JSON.parse(transfer.getData(DEVICE_MIME))).toEqual({ benchId: 'bench-1', deviceId: 'dev-1' });
    expect(transfer.effectAllowed).toBe('move');
    const target = tile('board-02');
    fireEvent.dragOver(target, { dataTransfer: transfer });
    expect(target).toHaveClass('drop-target');
    expect(transfer.dropEffect).toBe('move');
    fireEvent.drop(target, { dataTransfer: transfer });
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as Lab;
    expect(labels(next, 'bench-1')).toEqual(['PDU']);
    expect(labels(next, 'bench-2')).toEqual(['ST-LINK', 'Console']);
    expect(ids(next, 'bench-2')).toEqual(['dev-1', 'dev-2']);
    expect(onSelectDevice).toHaveBeenCalledWith('bench-2', 'dev-2');
    expect(screen.getByRole('status')).toHaveTextContent('Console moved to board-02');
    expect(target).not.toHaveClass('drop-target');
  });

  it('inserts before the brick it is dropped on', () => {
    const onChange = vi.fn();
    render(<LabCanvas lab={twoBenchLab()} catalog={hardwareCatalog} onChange={onChange} />);
    const transfer = dataTransfer();
    fireEvent.dragStart(brick('PDU', 'board-01'), { dataTransfer: transfer });
    const stlink = brick('ST-LINK', 'board-02');
    fireEvent.dragOver(stlink, { dataTransfer: transfer });
    expect(stlink).toHaveClass('drop-before');
    fireEvent.drop(stlink, { dataTransfer: transfer });
    const next = onChange.mock.calls[0][0] as Lab;
    expect(labels(next, 'bench-2')).toEqual(['PDU', 'ST-LINK']);
    expect(labels(next, 'bench-1')).toEqual(['Console']);
  });

  it('reorders within a bench when dropped on a sibling, and ignores no-op drops', () => {
    const onChange = vi.fn();
    render(<LabCanvas lab={twoBenchLab()} catalog={hardwareCatalog} onChange={onChange} />);
    const transfer = dataTransfer();
    fireEvent.dragStart(brick('PDU', 'board-01'), { dataTransfer: transfer });
    fireEvent.drop(brick('Console', 'board-01'), { dataTransfer: transfer });
    expect(labels(onChange.mock.calls[0][0] as Lab, 'bench-1')).toEqual(['PDU', 'Console']);
    onChange.mockClear();
    // Dropping the last brick onto its own tile body keeps the order.
    fireEvent.dragStart(brick('PDU', 'board-01'), { dataTransfer: dataTransfer() });
    fireEvent.drop(tile('board-01'), { dataTransfer: dataTransfer() });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('adds a blank device when a palette brick is dropped on a tile', () => {
    const onChange = vi.fn();
    const onSelectDevice = vi.fn();
    render(<LabCanvas lab={twoBenchLab()} catalog={hardwareCatalog} onChange={onChange} onSelectDevice={onSelectDevice} />);
    const palette = screen.getByRole('group', { name: 'Device bricks' });
    const mux = within(palette).getByRole('button', { name: /^Add USB-SD-Mux/ });
    const transfer = dataTransfer();
    fireEvent.dragStart(mux, { dataTransfer: transfer });
    expect(transfer.getData(KIND_MIME)).toBe('usb-sd-mux');
    const target = tile('board-01');
    fireEvent.dragOver(target, { dataTransfer: transfer });
    expect(transfer.dropEffect).toBe('copy');
    fireEvent.drop(target, { dataTransfer: transfer });
    const next = onChange.mock.calls[0][0] as Lab;
    const devices = next.benches[0].devices;
    expect(devices).toHaveLength(3);
    expect(devices[2]).toMatchObject({ id: 'dev-3', kind: 'usb-sd-mux', label: 'USB-SD-Mux', match: { ID_PATH: '' } });
    expect(onSelectDevice).toHaveBeenCalledWith('bench-1', 'dev-3');
    expect(screen.getByRole('status')).toHaveTextContent('USB-SD-Mux added to board-01');
  });

  it('accepts drops described only by the data transfer', () => {
    const onChange = vi.fn();
    render(<LabCanvas lab={twoBenchLab()} catalog={hardwareCatalog} onChange={onChange} />);
    const transfer = dataTransfer();
    transfer.setData(KIND_MIME, 'ykush');
    const target = tile('board-02');
    fireEvent.dragOver(target, { dataTransfer: transfer });
    expect(target).toHaveClass('drop-target');
    fireEvent.drop(target, { dataTransfer: transfer });
    expect(labels(onChange.mock.calls[0][0] as Lab, 'bench-2')).toEqual(['ST-LINK', 'YKUSH port']);
    // Foreign payloads are ignored.
    onChange.mockClear();
    const foreign = dataTransfer();
    foreign.setData('text/plain', 'hello');
    fireEvent.drop(target, { dataTransfer: foreign });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('adds to the selected bench when a palette brick is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LabCanvas lab={twoBenchLab()} catalog={hardwareCatalog} selectedBenchId="bench-2" onChange={onChange} />);
    expect(screen.getByText(/click one to add it to board-02/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add Network PDU outlet to board-02' }));
    const next = onChange.mock.calls[0][0] as Lab;
    expect(labels(next, 'bench-2')).toEqual(['ST-LINK', 'PDU outlet']);
    expect(screen.getByRole('status')).toHaveTextContent('PDU outlet added to board-02');
  });

  it('asks for a bench when several exist and none is selected', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LabCanvas lab={twoBenchLab()} catalog={hardwareCatalog} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Add Yepkit YKUSH port (select a bench first)' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Select a bench first');
  });

  it('targets the only bench without a selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LabCanvas lab={labFromProfile(piProfile())} catalog={hardwareCatalog} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Add Debug probe for OpenOCD to board-01' }));
    expect(labels(onChange.mock.calls[0][0] as Lab, 'bench-1')).toEqual(['Console', 'PDU', 'Debug probe']);
  });

  it('moves a brick with the keyboard toolbar: move to, up and down', () => {
    const onChange = vi.fn();
    const onSelectDevice = vi.fn();
    render(
      <LabCanvas lab={twoBenchLab()} catalog={hardwareCatalog} selectedBenchId="bench-1" selectedDeviceId="dev-2" onChange={onChange} onSelectDevice={onSelectDevice} />,
    );
    const pdu = brick('PDU', 'board-01');
    expect(pdu).toHaveClass('selected');
    const select = within(pdu).getByRole('combobox', { name: 'Move PDU to another bench' });
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['Move to…', 'board-02']);
    fireEvent.change(select, { target: { value: 'bench-2' } });
    let next = onChange.mock.calls[0][0] as Lab;
    expect(labels(next, 'bench-1')).toEqual(['Console']);
    expect(labels(next, 'bench-2')).toEqual(['ST-LINK', 'PDU']);
    expect(onSelectDevice).toHaveBeenCalledWith('bench-2', 'dev-2');
    expect(screen.getByRole('status')).toHaveTextContent('PDU moved to board-02');

    onChange.mockClear();
    expect(within(pdu).getByRole('button', { name: 'Move PDU down' })).toBeDisabled();
    fireEvent.click(within(pdu).getByRole('button', { name: 'Move PDU up' }));
    next = onChange.mock.calls[0][0] as Lab;
    expect(labels(next, 'bench-1')).toEqual(['PDU', 'Console']);
    expect(screen.getByRole('status')).toHaveTextContent('PDU moved up in board-01');
    // The toolbar stays out of bricks that are neither selected nor focused.
    expect(within(brick('Console', 'board-01')).queryByRole('group', { name: 'Console actions' })).not.toBeInTheDocument();
  });

  it('shows the toolbar while a brick has focus', async () => {
    const user = userEvent.setup();
    render(<LabCanvas lab={twoBenchLab()} catalog={hardwareCatalog} />);
    const console = brick('Console', 'board-01');
    expect(within(console).queryByRole('group', { name: 'Console actions' })).not.toBeInTheDocument();
    await user.tab();
    expect(within(console).getByRole('button', { name: /^Console:/ })).toHaveFocus();
    expect(within(console).getByRole('group', { name: 'Console actions' })).toBeInTheDocument();
    await user.tab();
    expect(within(console).getByRole('combobox', { name: 'Move Console to another bench' })).toHaveFocus();
  });

  it('removes a brick only on the second click and forgets the request after a while', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<LabCanvas lab={twoBenchLab()} catalog={hardwareCatalog} selectedBenchId="bench-1" selectedDeviceId="dev-1" onChange={onChange} />);
    const console = brick('Console', 'board-01');
    const remove = within(console).getByRole('button', { name: 'Remove Console from board-01' });
    fireEvent.click(remove);
    expect(onChange).not.toHaveBeenCalled();
    expect(within(console).getByRole('button', { name: 'Confirm removing Console from board-01' })).toHaveTextContent('Confirm remove');
    act(() => { vi.advanceTimersByTime(4100); });
    expect(within(console).getByRole('button', { name: 'Remove Console from board-01' })).toBeInTheDocument();
    fireEvent.click(within(console).getByRole('button', { name: 'Remove Console from board-01' }));
    fireEvent.click(within(console).getByRole('button', { name: 'Confirm removing Console from board-01' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(labels(onChange.mock.calls[0][0] as Lab, 'bench-1')).toEqual(['PDU']);
    expect(screen.getByRole('status')).toHaveTextContent('Removed Console from board-01');
    vi.useRealTimers();
  });

  it('reports clicks on bricks and boards', async () => {
    const user = userEvent.setup();
    const onSelectBench = vi.fn();
    const onSelectDevice = vi.fn();
    render(<LabCanvas lab={twoBenchLab()} catalog={hardwareCatalog} onSelectBench={onSelectBench} onSelectDevice={onSelectDevice} />);
    await user.click(screen.getByRole('button', { name: 'Board STM32 Nucleo-64, place board-02' }));
    expect(onSelectBench).toHaveBeenCalledWith('bench-2');
    await user.click(within(brick('ST-LINK', 'board-02')).getByRole('button', { name: /^ST-LINK:/ }));
    expect(onSelectDevice).toHaveBeenCalledWith('bench-2', 'dev-1');
    expect(tile('board-02')).not.toHaveClass('selected');
  });

  it('marks the selected tile and brick', () => {
    render(<LabCanvas lab={twoBenchLab()} catalog={hardwareCatalog} selectedDeviceId="dev-1" selectedBenchId="bench-2" />);
    expect(tile('board-02')).toHaveClass('selected');
    expect(brick('ST-LINK', 'board-02')).toHaveClass('selected');
    expect(brick('Console', 'board-01')).not.toHaveClass('selected');
  });

  it('adds a bench from the trailing tile', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSelectBench = vi.fn();
    render(<LabCanvas lab={twoBenchLab()} catalog={hardwareCatalog} onChange={onChange} onSelectBench={onSelectBench} />);
    await user.click(screen.getByRole('button', { name: '+ Add bench' }));
    const next = onChange.mock.calls[0][0] as Lab;
    expect(next.benches.map((bench) => bench.id)).toEqual(['bench-1', 'bench-2', 'bench-3']);
    expect(benchLabel(next.benches[2])).toBe('board-03');
    expect(onSelectBench).toHaveBeenCalledWith('bench-3');
    expect(screen.getByRole('status')).toHaveTextContent('Added bench board-03');
  });

  it('hides editing affordances in read-only mode but still reports selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSelectDevice = vi.fn();
    render(
      <LabCanvas lab={twoBenchLab()} catalog={hardwareCatalog} readOnly selectedBenchId="bench-1" selectedDeviceId="dev-1" onChange={onChange} onSelectDevice={onSelectDevice} />,
    );
    expect(screen.queryByRole('group', { name: 'Device bricks' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Add bench' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Drop here/)).not.toBeInTheDocument();
    const console = brick('Console', 'board-01');
    expect(console).toHaveAttribute('draggable', 'false');
    expect(within(console).queryByRole('group', { name: 'Console actions' })).not.toBeInTheDocument();
    await user.click(within(console).getByRole('button', { name: /^Console:/ }));
    expect(onSelectDevice).toHaveBeenCalledWith('bench-1', 'dev-1');
    const transfer = dataTransfer();
    transfer.setData(KIND_MIME, 'ykush');
    fireEvent.dragOver(tile('board-02'), { dataTransfer: transfer });
    fireEvent.drop(tile('board-02'), { dataTransfer: transfer });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('labels empty benches and unnamed boards plainly', () => {
    const { lab } = addBench(labFromProfile(piProfile()));
    render(<LabCanvas lab={lab} catalog={hardwareCatalog} readOnly />);
    const empty = tile('board-02');
    expect(within(empty).getByText('No devices')).toBeInTheDocument();
    expect(within(empty).getByRole('button', { name: 'Board Unnamed board, place board-02' })).toBeInTheDocument();
  });
});
