import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';

describe('core user journey', () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('moves from landing to a remote network PDU recommendation and copies YAML', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    render(<App />);

    await user.click(screen.getByRole('button', { name: /open remote power control guide/i }));

    await user.click(screen.getByRole('button', { name: /board with an external dc adapter/i }));
    await user.click(screen.getByRole('button', { name: /^continue/i }));
    await user.click(screen.getByRole('button', { name: /network-controlled pdu/i }));
    await user.click(screen.getByRole('button', { name: /^continue/i }));
    await user.click(screen.getByRole('button', { name: /another network host/i }));
    await user.click(screen.getByRole('button', { name: /^continue/i }));
    await user.click(screen.getByRole('button', { name: /^netio/i }));
    await user.click(screen.getByRole('button', { name: /see recommendation/i }));

    expect(screen.getByRole('heading', { name: /control the board's power adapter/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /share power control safely/i })).toBeInTheDocument();
    expect(screen.getByText('exporter.yaml')).toBeInTheDocument();
    expect(screen.getByText('remote.yaml')).toBeInTheDocument();
    expect(screen.getByText(/model: 'netio'/)).toBeInTheDocument();

    await user.click(screen.getByText(/show 2 generated yaml files/i));
    await user.click(screen.getAllByRole('button', { name: /copy configuration/i })[0]);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('NetworkPowerPort'));
    expect(screen.getAllByRole('button', { name: /copied/i })[0]).toBeInTheDocument();
  });

  it('offers every setup workflow from the landing page', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getAllByRole('button', { name: /open .* guide/i })).toHaveLength(7);
    await user.click(screen.getByRole('button', { name: /open serial console access guide/i }));
    expect(screen.getByRole('heading', { name: /how is the serial console exposed/i })).toBeInTheDocument();
  });

  it('switches theme and remembers the choice', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /switch to dark mode/i }));

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(window.localStorage.getItem('labgrid-advisor-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: /switch to light mode/i })).toBeInTheDocument();
  });

  it('gives a safe next step when a beginner does not know the serial interface', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /open serial console access guide/i }));
    await user.click(screen.getByRole('button', { name: /i am not sure yet/i }));
    await user.click(screen.getByRole('button', { name: /see recommendation/i }));

    expect(screen.getByRole('heading', { name: /identify the serial connection/i })).toBeInTheDocument();
    expect(screen.getByText(/no safe configuration generated/i)).toBeInTheDocument();
  });
});
