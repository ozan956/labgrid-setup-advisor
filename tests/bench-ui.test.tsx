import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { sampleBenches } from '../src/bench/samples';
import { encodeShareHash } from '../src/bench/storage';

const LSUSB = `Bus 001 Device 001: ID 1d6b:0002 Linux Foundation 2.0 root hub
Bus 001 Device 002: ID 10c4:ea60 Silicon Labs CP210x UART Bridge
Bus 001 Device 003: ID 0483:374b STMicroelectronics ST-LINK/V2.1`;

describe('bench journey', () => {
  beforeAll(() => {
    if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => 'blob:mock');
    if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn();
  });

  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    window.location.hash = '';
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    window.location.hash = '';
  });

  it('detects pasted lsusb output, builds a plan, and lists tailored steps', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /describe my bench/i }));
    expect(screen.getByRole('heading', { name: /describe your bench/i })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/paste command output/i), LSUSB);
    await user.click(screen.getByRole('button', { name: /detect devices/i }));

    expect(screen.getByText(/recognized lsusb output/i)).toBeInTheDocument();
    const candidates = screen.getAllByRole('checkbox');
    expect(candidates.length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText('Console').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Debug probe')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /add selected devices/i }));
    expect(screen.getByRole('heading', { name: /devices \(3\)/i })).toBeInTheDocument();

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
    expect(window.localStorage.getItem('labgrid-advisor-bench')).toContain('nucleo-01');
  });

  it('opens a guide with complete answers straight on the results page', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /try an example bench/i }));
    await user.click(screen.getByRole('button', { name: /raspberry pi 4 in a shared lab/i }));

    expect(screen.getByRole('heading', { name: /your bench plan/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /open remote power control with my answers/i }));

    expect(screen.getByRole('heading', { name: /your remote power control setup/i })).toBeInTheDocument();
    expect(screen.getByText(/host: 'netio-rack2\.lab\.example\.org'/)).toBeInTheDocument();
    expect(screen.getAllByText(/ready to use/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByDisplayValue('netio-rack2.lab.example.org')).toBeInTheDocument();
    expect(screen.getAllByText(/from your bench/i).length).toBeGreaterThanOrEqual(1);
  });

  it('loads a shared bench from the URL hash', () => {
    const sample = sampleBenches.find((bench) => bench.id === 'pi4-pdu-remote')!;
    window.location.hash = encodeShareHash(sample.profile);
    render(<App />);

    expect(screen.getByRole('heading', { name: /your bench plan/i })).toBeInTheDocument();
    expect(screen.getAllByText(/raspberry pi 4 model b/i).length).toBeGreaterThanOrEqual(1);
    expect(window.location.hash).toBe('');
  });

  it('updates the generated YAML as values are typed on the results page', async () => {
    const user = userEvent.setup();
    render(<App />);

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

    const values = screen.getByRole('region', { name: /your values/i });
    await user.type(within(values).getByLabelText(/pdu hostname or address/i), 'pdu-01.lab');
    expect(screen.getByText(/host: 'pdu-01\.lab'/)).toBeInTheDocument();
    expect(screen.getAllByText(/template — not ready to run/i).length).toBeGreaterThanOrEqual(1);
  });
});
