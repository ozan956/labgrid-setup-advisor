import { StrictMode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { sampleBenches } from '../src/bench/samples';
import { encodeShareHash } from '../src/bench/storage';

const LSUSB = `Bus 001 Device 001: ID 1d6b:0002 Linux Foundation 2.0 root hub
Bus 001 Device 002: ID 10c4:ea60 Silicon Labs CP210x UART Bridge
Bus 001 Device 003: ID 0483:374b STMicroelectronics ST-LINK/V2.1`;

const pi4 = sampleBenches.find((bench) => bench.id === 'pi4-pdu-remote')!;

function renderApp() {
  return render(<StrictMode><App /></StrictMode>);
}

async function openEmptyBench(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /describe my bench/i }));
  expect(screen.getByRole('heading', { name: /describe your bench/i })).toBeInTheDocument();
}

async function loadSample(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /try an example bench/i }));
  await user.click(screen.getByRole('button', { name: /raspberry pi 4 in a shared lab/i }));
  expect(screen.getByRole('heading', { name: /your bench plan/i })).toBeInTheDocument();
}

describe('bench journey', () => {
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
    vi.useRealTimers();
  });

  it('detects pasted lsusb output, builds a plan, and lists tailored steps', async () => {
    const user = userEvent.setup();
    renderApp();
    await openEmptyBench(user);

    await user.click(screen.getByLabelText(/paste command output/i));
    await user.paste(LSUSB);
    await user.click(screen.getByRole('button', { name: /detect devices/i }));

    expect(screen.getByText(/recognized lsusb output/i)).toBeInTheDocument();
    const candidates = within(screen.getByRole('list', { name: /detected devices/i }));
    expect(candidates.getAllByRole('checkbox')).toHaveLength(3);
    expect(candidates.getAllByText('Console', { selector: '.candidate-label' }).length).toBeGreaterThanOrEqual(1);
    expect(candidates.getByText('Debug probe', { selector: '.candidate-label' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /add selected devices/i }));
    expect(screen.getByRole('heading', { name: /devices \(3\)/i })).toBeInTheDocument();
    expect(screen.getByText(/added 3 devices to your bench/i)).toBeInTheDocument();

    const pathInput = screen.getAllByLabelText(/match value for ID_PATH/i)[0];
    await user.type(pathInput, 'pci-0000:00:14.0-usb-0:1.3:1.0');

    const place = screen.getByLabelText(/place name/i);
    await user.clear(place);
    await user.type(place, 'nucleo-01');
    expect(screen.getByLabelText(/exporter group/i)).toHaveValue('nucleo-01');

    await user.click(screen.getByRole('button', { name: /see my plan/i }));

    expect(screen.getByRole('heading', { name: /your bench plan/i })).toBeInTheDocument();
    expect(screen.getAllByText('environment.yaml').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/USBSerialPort:/)).toBeInTheDocument();
    expect(screen.getAllByText(/pci-0000:00:14\.0-usb-0:1\.3:1\.0/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/fix before using the files/i)).toBeInTheDocument();
    expect(screen.getAllByText(/pytest --lg-env environment\.yaml/).length).toBeGreaterThanOrEqual(1);
    expect(window.localStorage.getItem('labgrid-advisor-lab')).toContain('nucleo-01');
  }, 20000);

  it('opens a guide with complete answers straight on the results page and keeps typed values', async () => {
    const user = userEvent.setup();
    renderApp();
    await loadSample(user);

    await user.click(screen.getByRole('button', { name: /open remote power control with my answers/i }));

    expect(screen.getByRole('heading', { name: /your remote power control setup/i })).toBeInTheDocument();
    expect(screen.getByText(/host: 'netio-rack2\.lab\.example\.org'/)).toBeInTheDocument();
    expect(screen.getAllByText(/ready to use/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByDisplayValue('netio-rack2.lab.example.org')).toBeInTheDocument();
    expect(screen.getAllByText(/from your bench/i).length).toBeGreaterThanOrEqual(1);

    const host = screen.getByDisplayValue('netio-rack2.lab.example.org');
    await user.clear(host);
    await user.type(host, 'pdu-typed.lab');
    expect(screen.getByText(/host: 'pdu-typed\.lab'/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^my bench$/i }));
    await user.click(screen.getByRole('button', { name: /open remote power control with my answers/i }));
    expect(screen.getByText(/host: 'pdu-typed\.lab'/)).toBeInTheDocument();
  }, 20000);

  it('shows the shared-bench strip for a share link and only saves on request', async () => {
    const user = userEvent.setup();
    window.location.hash = encodeShareHash(pi4.profile);
    renderApp();

    expect(screen.getByRole('heading', { name: /your bench plan/i })).toBeInTheDocument();
    expect(screen.getAllByText(/raspberry pi 4 model b/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/you are viewing a shared bench/i)).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(window.localStorage.getItem('labgrid-advisor-lab')).toBeNull();

    await user.click(screen.getByRole('button', { name: /save as my bench/i }));
    expect(window.localStorage.getItem('labgrid-advisor-lab')).toContain('pi4-01');
    expect(screen.queryByText(/you are viewing a shared bench/i)).not.toBeInTheDocument();
  });

  it('discards a shared bench and returns to the landing page when nothing was saved', async () => {
    const user = userEvent.setup();
    window.location.hash = encodeShareHash(pi4.profile);
    renderApp();

    await user.click(screen.getByRole('button', { name: /^discard$/i }));
    expect(screen.getByRole('heading', { name: /start with your hardware/i })).toBeInTheDocument();
    expect(window.localStorage.getItem('labgrid-advisor-lab')).toBeNull();
  });

  it('explains an unreadable share link', () => {
    window.location.hash = '#bench=not-base64!!';
    renderApp();
    expect(screen.getByRole('alert')).toHaveTextContent(/share link could not be read/i);
    expect(window.location.hash).toBe('');
  });

  it('updates the generated YAML as values are typed on the results page', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: /open remote power control guide/i }));
    await user.click(screen.getByRole('button', { name: /through a separate dc adapter/i }));
    await user.click(screen.getByRole('button', { name: /^continue/i }));
    await user.click(screen.getByRole('button', { name: /one board or power channel/i }));
    await user.click(screen.getByRole('button', { name: /^continue/i }));
    await user.click(screen.getByRole('button', { name: /network-controlled pdu/i }));
    await user.click(screen.getByRole('button', { name: /^continue/i }));
    await user.click(screen.getByRole('button', { name: /through another linux host/i }));
    await user.click(screen.getByRole('button', { name: /^continue/i }));
    await user.click(screen.getByRole('button', { name: /^netio/i }));
    await user.click(screen.getByRole('button', { name: /see recommendation/i }));

    expect(screen.getByRole('heading', { name: /your remote power control setup/i })).toHaveFocus();
    const values = screen.getByRole('region', { name: /your values/i });
    await user.type(within(values).getByLabelText(/pdu hostname or address/i), 'pdu-01.lab');
    expect(screen.getByText(/host: 'pdu-01\.lab'/)).toBeInTheDocument();
    expect(screen.getAllByText(/template — not ready to run/i).length).toBeGreaterThanOrEqual(1);
  });

  it('adds a blank device, lets the user remove it, and supports custom baud rates', async () => {
    const user = userEvent.setup();
    renderApp();
    await openEmptyBench(user);

    await user.selectOptions(screen.getByLabelText(/add a device/i), 'usb-serial');
    await user.click(screen.getByRole('button', { name: /^add$/i }));
    expect(screen.getByRole('heading', { name: /devices \(1\)/i })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^baud rate$/i), '__custom__');
    const custom = screen.getByLabelText(/custom baud rate/i);
    await user.clear(custom);
    expect(custom).toHaveValue(null);
    await user.type(custom, '1500000');
    expect(JSON.parse(window.localStorage.getItem('labgrid-advisor-lab')!).benches[0].devices[0].speed).toBe(1500000);

    await user.click(screen.getByRole('button', { name: 'Remove Console' }));
    expect(screen.getByRole('heading', { name: /devices \(0\)/i })).toBeInTheDocument();
  });

  it('keeps the group name in step with the place until the user detaches it, and blocks invalid names', async () => {
    const user = userEvent.setup();
    renderApp();
    await openEmptyBench(user);

    const place = screen.getByLabelText(/place name/i);
    const group = screen.getByLabelText(/exporter group/i);
    expect(group).toBeDisabled();
    await user.clear(place);
    await user.type(place, 'imx-01');
    expect(group).toHaveValue('imx-01');

    await user.click(screen.getByLabelText(/same as place/i));
    expect(group).toBeEnabled();
    await user.clear(group);
    await user.type(group, 'rack-a');
    expect(group).toHaveValue('rack-a');
    await user.type(place, '!');
    expect(place).toHaveValue('imx-01!');
    expect(group).toHaveValue('rack-a');

    expect(screen.getByRole('alert')).toHaveTextContent(/letters, digits/i);
    expect(screen.getByRole('button', { name: /see my plan/i })).toBeDisabled();
    expect(screen.getByText(/fix the place or group name first/i)).toBeInTheDocument();

    await user.clear(place);
    expect(screen.getByRole('alert')).toHaveTextContent(/a place name is required/i);
  });

  it('reports an unparsable JSON import in plain words', async () => {
    const user = userEvent.setup();
    renderApp();
    await openEmptyBench(user);

    await user.upload(screen.getByLabelText(/import json/i), new File(['{not json'], 'broken.json', { type: 'application/json' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/the file is not valid json/i);
  });

  it('explains schema problems of an imported file with their location', async () => {
    const user = userEvent.setup();
    renderApp();
    await openEmptyBench(user);

    await user.upload(screen.getByLabelText(/import json/i), new File([JSON.stringify({ version: 1 })], 'short.json', { type: 'application/json' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/in the file, the top level must have required property/i);
  });

  it('confirms a successful JSON import', async () => {
    const user = userEvent.setup();
    renderApp();
    await openEmptyBench(user);

    await user.upload(screen.getByLabelText(/import json/i), new File([JSON.stringify(pi4.profile)], 'bench.json', { type: 'application/json' }));
    expect(await screen.findByText(/imported 2 devices/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /devices \(2\)/i })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('asks for a second click before resetting and forgets the request after four seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderApp();
    await loadSample(user);
    window.localStorage.setItem('labgrid-advisor-lab-checklist:bench-1', JSON.stringify(['install-labgrid']));
    await user.click(screen.getAllByRole('button', { name: /edit bench/i })[0]);
    expect(screen.getByRole('heading', { name: /devices \(2\)/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /reset lab/i }));
    expect(screen.getByRole('button', { name: /really reset/i })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/click again within 4 seconds/i);
    vi.advanceTimersByTime(4100);
    expect(await screen.findByRole('button', { name: /^reset lab$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /devices \(2\)/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /reset lab/i }));
    await user.click(screen.getByRole('button', { name: /really reset/i }));
    expect(screen.getByRole('heading', { name: /devices \(0\)/i })).toBeInTheDocument();
    expect(window.localStorage.getItem('labgrid-advisor-lab-checklist:bench-1')).toBeNull();
    expect(screen.getByLabelText(/exporter group/i)).toBeDisabled();
  });

  it('persists checklist ticks per place and restores them after a reload', async () => {
    const user = userEvent.setup();
    const first = renderApp();
    await loadSample(user);

    const checklist = within(screen.getByRole('list', { name: /setup steps/i }));
    const [firstStep] = checklist.getAllByRole('checkbox');
    await user.click(firstStep);
    expect(screen.getByText(/1 of \d+ done/i)).toBeInTheDocument();
    const stored = JSON.parse(window.localStorage.getItem('labgrid-advisor-lab-checklist:bench-1')!);
    expect(stored).toHaveLength(1);

    first.unmount();
    renderApp();
    await user.click(screen.getByRole('button', { name: /^my bench$/i }));
    expect(screen.getByRole('heading', { name: /your bench plan/i })).toBeInTheDocument();
    const again = within(screen.getByRole('list', { name: /setup steps/i }));
    expect(again.getAllByRole('checkbox')[0]).toBeChecked();
  });

  it('falls back to a selectable link when the clipboard is unavailable and downloads the bundle', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    renderApp();
    await loadSample(user);

    await user.click(screen.getByRole('button', { name: /copy share link/i }));
    const link = (await screen.findByLabelText(/^share link$/i)) as HTMLInputElement;
    expect(link.value).toContain('#lab=');

    await user.click(screen.getAllByRole('button', { name: /download bundle/i })[0]);
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('lets a pre-filled wizard jump to the results and returns to the right place on exit', async () => {
    const user = userEvent.setup();
    renderApp();
    await loadSample(user);

    await user.click(screen.getByRole('button', { name: /labgrid setup advisor home/i }));
    await user.click(screen.getByRole('button', { name: /open remote power control guide/i }));
    expect(screen.getByRole('status')).toHaveTextContent(/filled from your bench/i);
    expect(screen.getByRole('button', { name: /← all setups/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /jump to results/i }));
    expect(screen.getByRole('heading', { name: /your remote power control setup/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^my bench$/i }));
    await user.click(screen.getByRole('button', { name: /open ci integration with my answers/i }));
    expect(screen.getByRole('heading', { name: /does the job need one exact board/i })).toBeInTheDocument();
    const back = screen.getByRole('button', { name: /← your bench plan/i });
    await user.click(back);
    expect(screen.getByRole('heading', { name: /your bench plan/i })).toBeInTheDocument();
  });
  it('shows how a preset was verified and lists its sources', async () => {
    const user = userEvent.setup();
    renderApp();
    await openEmptyBench(user);

    const picker = screen.getByLabelText(/known boards/i) as HTMLSelectElement;
    expect(within(picker).getByRole('option', { name: /raspberry pi 4 model b \(from documentation\)/i })).toBeInTheDocument();
    await user.selectOptions(picker, 'raspberry-pi-4');

    const facts = within(screen.getByRole('complementary', { name: /raspberry pi 4 model b facts/i }));
    expect(facts.getByText('From documentation')).toHaveClass('verification-badge', 'verification-docs');
    expect(facts.queryByText(/not yet reviewed/i)).not.toBeInTheDocument();
  });

  it('offers the bench as a lab-verified board preset on the plan page', async () => {
    const user = userEvent.setup();
    renderApp();
    await loadSample(user);

    expect(screen.getByRole('heading', { name: /contribute this board/i })).toBeInTheDocument();
    const article = screen.getByRole('article', { name: /board preset \(board-raspberry-pi-4-model-b\.yaml\)/i });
    const card = within(article);
    expect(card.getByText(/passes the catalog schema/i)).toBeInTheDocument();
    expect(article.querySelector('pre')?.textContent).toContain('    verification: lab\n');
    expect(article.querySelector('pre')?.textContent).toContain('- id: raspberry-pi-4-model-b');
    expect(card.getByText(/share it only after the checklist passed/i)).toBeInTheDocument();

    await user.click(card.getByRole('button', { name: /download board-raspberry-pi-4-model-b\.yaml/i }));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });
});
