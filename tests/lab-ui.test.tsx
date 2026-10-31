import { StrictMode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { hardwareCatalog } from '../src/bench/catalog';
import { addBench, labFromProfile } from '../src/bench/lab';
import { sampleBenches } from '../src/bench/samples';
import { LAB_STORAGE_KEY, STORAGE_KEY, encodeShareHash } from '../src/bench/storage';
import type { Lab } from '../src/bench/types';
import { LabEditor } from '../src/components/lab/LabEditor';

const pi4 = sampleBenches.find((bench) => bench.id === 'pi4-pdu-remote')!;

function renderApp() {
  return render(<StrictMode><App /></StrictMode>);
}

function storedLab(): Lab {
  return JSON.parse(window.localStorage.getItem(LAB_STORAGE_KEY)!) as Lab;
}

async function openEmptyBench(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /describe my bench/i }));
  expect(screen.getByRole('heading', { name: /describe your bench/i })).toBeInTheDocument();
}

async function openSampleEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /try an example bench/i }));
  await user.click(screen.getByRole('button', { name: /raspberry pi 4 in a shared lab/i }));
  await user.click(screen.getAllByRole('button', { name: /^edit bench$/i })[0]);
  expect(screen.getByRole('heading', { name: /bench 1: raspberry pi 4 model b/i })).toBeInTheDocument();
}

describe('lab editor', () => {
  beforeAll(() => {
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });

  beforeEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.location.hash = '';
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    window.location.hash = '';
  });

  it('adds a bench with the next free place name, lists it in the rail, and moves focus to it', async () => {
    const user = userEvent.setup();
    renderApp();
    await openEmptyBench(user);

    expect(screen.getByRole('heading', { name: /benches \(1\)/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^add bench$/i }));

    expect(screen.getByRole('heading', { name: /describe your lab/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /benches \(2\)/i })).toBeInTheDocument();
    const second = screen.getByRole('button', { name: /bench 2: unnamed board, place board-02, 0 devices/i });
    expect(second).toHaveAttribute('aria-current', 'true');
    const heading = screen.getByRole('heading', { name: /^bench 2: unnamed board$/i });
    expect(heading).toHaveFocus();
    expect(screen.getByLabelText(/place name/i)).toHaveValue('board-02');
    expect(screen.getByRole('status')).toHaveTextContent(/added bench 2 with place board-02/i);
    expect(screen.getByRole('button', { name: /^my lab$/i })).toBeInTheDocument();
    expect(storedLab().benches.map((bench) => bench.place)).toEqual(['board-01', 'board-02']);
  });

  it('edits only the selected bench', async () => {
    const user = userEvent.setup();
    renderApp();
    await openEmptyBench(user);
    await user.click(screen.getByRole('button', { name: /^add bench$/i }));

    await user.type(screen.getByLabelText(/board name/i), 'Nucleo');
    expect(screen.getByRole('heading', { name: /^bench 2: nucleo$/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^bench 1:/i }));
    expect(screen.getByRole('heading', { name: /^bench 1: unnamed board$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/board name/i)).toHaveValue('');
    expect(screen.getByRole('button', { name: /^bench 2: nucleo,/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^bench 2:/i }));
    expect(screen.getByLabelText(/board name/i)).toHaveValue('Nucleo');
    expect(storedLab().benches.map((bench) => bench.board.name)).toEqual(['', 'Nucleo']);
  });

  it('duplicates a bench for a second unit: devices copied, udev matches cleared, next place name', async () => {
    const user = userEvent.setup();
    renderApp();
    await openSampleEditor(user);

    await user.click(screen.getByRole('button', { name: /^duplicate bench$/i }));

    expect(screen.getByRole('status')).toHaveTextContent(/duplicated raspberry pi 4 model b as bench 2 with place board-01/i);
    expect(screen.getByRole('heading', { name: /^bench 2: raspberry pi 4 model b$/i })).toHaveFocus();
    expect(screen.getByRole('heading', { name: /devices \(2\)/i })).toBeInTheDocument();
    expect(screen.getAllByLabelText(/match value for ID_PATH/i)[0]).toHaveValue('');
    expect(screen.getByLabelText(/place name/i)).toHaveValue('board-01');
    expect(screen.getByLabelText(/exporter group/i)).toHaveValue('board-01');
    expect(screen.getByRole('button', { name: /^my lab$/i })).toBeInTheDocument();

    // The original keeps its match value.
    await user.click(screen.getByRole('button', { name: /^bench 1:/i }));
    expect(screen.getAllByLabelText(/match value for ID_PATH/i)[0]).toHaveValue('pci-0000:00:14.0-usb-0:1.3:1.0');

    await user.click(screen.getByRole('button', { name: /labgrid setup advisor home/i }));
    expect(screen.getByRole('region', { name: /your lab/i })).toHaveTextContent(/2 benches/i);
    expect(screen.getByRole('button', { name: /^edit lab$/i })).toBeInTheDocument();
  });

  it('removes a bench after a second click and never leaves the lab empty', async () => {
    const user = userEvent.setup();
    renderApp();
    await openSampleEditor(user);
    await user.click(screen.getByRole('button', { name: /^duplicate bench$/i }));

    await user.click(screen.getByRole('button', { name: /^remove bench$/i }));
    await user.click(screen.getByRole('button', { name: /really remove\?/i }));
    expect(screen.getByRole('status')).toHaveTextContent(/removed bench 2 \(raspberry pi 4 model b\)\. 1 bench left/i);
    expect(screen.getByRole('heading', { name: /benches \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^bench 1: raspberry pi 4 model b$/i })).toHaveFocus();
    expect(screen.getByRole('button', { name: /^my bench$/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^remove bench$/i }));
    await user.click(screen.getByRole('button', { name: /really remove\?/i }));
    expect(screen.getByRole('status')).toHaveTextContent(/the lab now has one empty bench/i);
    expect(screen.getByRole('heading', { name: /devices \(0\)/i })).toBeInTheDocument();
    expect(storedLab().benches).toHaveLength(1);
  });

  it('reorders benches with the move buttons', async () => {
    const user = userEvent.setup();
    renderApp();
    await openEmptyBench(user);
    await user.click(screen.getByRole('button', { name: /^add bench$/i }));
    await user.type(screen.getByLabelText(/board name/i), 'Second');
    expect(screen.getByRole('button', { name: /move bench down/i })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /move bench up/i }));

    expect(screen.getByRole('heading', { name: /^bench 1: second$/i })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/moved second to position 1 of 2/i);
    const rail = within(screen.getByRole('navigation', { name: /benches/i }));
    expect(rail.getAllByRole('button').map((button) => button.getAttribute('aria-label'))[0]).toMatch(/^bench 1: second/i);
    expect(screen.getByRole('button', { name: /move bench up/i })).toBeDisabled();
    expect(storedLab().benches.map((bench) => bench.board.name)).toEqual(['Second', '']);
  });

  it('applies lab-level settings to every bench', async () => {
    const user = userEvent.setup();
    renderApp();
    await openSampleEditor(user);
    await user.click(screen.getByRole('button', { name: /^duplicate bench$/i }));

    const host = screen.getByLabelText(/exporter host name/i);
    expect(host).toHaveValue('lab-exporter-1');
    await user.clear(host);
    await user.type(host, 'rack-pc');
    await user.type(screen.getByLabelText(/lab name/i), 'Rack 3');

    const lab = storedLab();
    expect(lab.name).toBe('Rack 3');
    expect(lab.names.exporterHost).toBe('rack-pc');
    expect(lab.benches).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: /see my plan/i }));
    expect(screen.getByRole('heading', { name: /rack 3 plan/i })).toBeInTheDocument();
    expect(screen.getAllByText(/rack-pc/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/board-01/).length).toBeGreaterThanOrEqual(1);
  });

  it('blocks the plan while two benches share a place name', async () => {
    const user = userEvent.setup();
    renderApp();
    await openEmptyBench(user);
    await user.click(screen.getByRole('button', { name: /^add bench$/i }));

    const place = screen.getByLabelText(/place name/i);
    await user.clear(place);
    await user.type(place, 'board-01');

    expect(screen.getByText(/two benches use the place name "board-01"/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /see my plan/i })).toBeDisabled();

    await user.clear(place);
    expect(screen.getByText(/fix the place or group name first/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^bench 1:/i }));
    expect(screen.getByText(/fix the place or group name of bench 2 first/i)).toBeInTheDocument();
  });

  it('opens a legacy #bench= link as a one-bench lab and saves it under the lab key', async () => {
    const user = userEvent.setup();
    window.location.hash = encodeShareHash(pi4.profile);
    renderApp();

    expect(screen.getByRole('heading', { name: /your bench plan/i })).toBeInTheDocument();
    expect(window.localStorage.getItem(LAB_STORAGE_KEY)).toBeNull();
    await user.click(screen.getByRole('button', { name: /save as my bench/i }));

    const lab = storedLab();
    expect(lab.version).toBe(2);
    expect(lab.benches).toHaveLength(1);
    expect(lab.benches[0].place).toBe('pi4-01');
    expect(lab.names.exporterHost).toBe('lab-exporter-1');
  });

  it('upgrades a bench saved by an earlier version when the app loads', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pi4.profile));
    renderApp();

    expect(screen.getByRole('region', { name: /your bench/i })).toHaveTextContent(/raspberry pi 4 model b/i);
    await user.click(screen.getByRole('button', { name: /^my bench$/i }));
    expect(screen.getByRole('heading', { name: /your bench plan/i })).toBeInTheDocument();
    expect(screen.getAllByText(/pi4-01/).length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getAllByRole('button', { name: /^edit bench$/i })[0]);
    await user.click(screen.getByRole('button', { name: /^add bench$/i }));
    expect(storedLab().benches).toHaveLength(2);
    expect(storedLab().benches[0].place).toBe('pi4-01');
  });

  it('imports a lab file with several benches', async () => {
    const user = userEvent.setup();
    renderApp();
    await openEmptyBench(user);

    const { lab } = addBench(labFromProfile(pi4.profile), { name: 'STM32 Nucleo-64', presetId: 'stm32-nucleo-64' });
    await user.upload(screen.getByLabelText(/import json/i), new File([JSON.stringify(lab)], 'lab.json', { type: 'application/json' }));

    expect(await screen.findByText(/imported a lab with 2 benches and 2 devices/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /benches \(2\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^bench 2: stm32 nucleo-64,/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^my lab$/i })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('still imports a single bench file and reports its devices', async () => {
    const user = userEvent.setup();
    renderApp();
    await openEmptyBench(user);

    await user.upload(screen.getByLabelText(/import json/i), new File([JSON.stringify(pi4.profile)], 'bench.json', { type: 'application/json' }));
    expect(await screen.findByText(/imported 2 devices for raspberry pi 4 model b/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /benches \(1\)/i })).toBeInTheDocument();
  });

  it('exports the whole lab as lab-profile.json', async () => {
    const user = userEvent.setup();
    renderApp();
    await openEmptyBench(user);
    await user.click(screen.getByRole('button', { name: /^add bench$/i }));
    await user.click(screen.getByRole('button', { name: /export json/i }));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });
});

describe('lab editor component', () => {
  beforeEach(() => {
    cleanup();
  });

  it('highlights and focuses the device selected from outside, such as the canvas', () => {
    const lab = labFromProfile(pi4.profile);
    render(
      <LabEditor
        lab={lab}
        catalog={hardwareCatalog}
        activeBenchId="bench-1"
        selectedDeviceId="dev-2"
        onChange={() => undefined}
        onSelectBench={() => undefined}
        onPlan={() => undefined}
        onReset={() => undefined}
        onExit={() => undefined}
        canvas={<div data-testid="canvas-slot">canvas</div>}
      />,
    );

    const card = screen.getByRole('article', { name: /pdu outlet device/i });
    expect(card).toHaveClass('highlighted');
    expect(card).toHaveAttribute('id', 'bench-bench-1-device-dev-2');
    expect(card).toHaveFocus();
    expect(screen.getByRole('article', { name: /console device/i })).not.toHaveClass('highlighted');
    expect(within(screen.getByRole('region', { name: /lab diagram/i })).getByTestId('canvas-slot')).toBeInTheDocument();
  });

  it('reports the device the user focuses so the canvas can follow', async () => {
    const user = userEvent.setup();
    const onSelectDevice = vi.fn();
    const lab = labFromProfile(pi4.profile);
    render(
      <LabEditor
        lab={lab}
        catalog={hardwareCatalog}
        activeBenchId="bench-1"
        onChange={() => undefined}
        onSelectBench={() => undefined}
        onSelectDevice={onSelectDevice}
        onPlan={() => undefined}
        onReset={() => undefined}
        onExit={() => undefined}
      />,
    );

    const label = within(screen.getByRole('article', { name: /pdu outlet device/i })).getByLabelText(/^label$/i);
    await user.click(label);
    expect(onSelectDevice).toHaveBeenCalledWith('bench-1', 'dev-2');
    expect(label).toHaveFocus();
    expect(screen.getByRole('article', { name: /pdu outlet device/i })).toHaveClass('highlighted');
  });
});
