import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App';

describe('core user journey', () => {
  it('moves from landing to a remote network PDU recommendation and copies YAML', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    render(<App />);

    await user.click(screen.getByRole('button', { name: /open remote power control guide/i }));

    await user.click(screen.getByRole('button', { name: /board with an external dc adapter/i }));
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await user.click(screen.getByRole('button', { name: /network-controlled pdu/i }));
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await user.click(screen.getByRole('button', { name: /another network host/i }));
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await user.click(screen.getByRole('button', { name: /^netio/i }));
    await user.click(screen.getByRole('button', { name: /show my setup/i }));

    expect(screen.getByRole('heading', { name: /switch the complete outlet/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /publish the controller/i })).toBeInTheDocument();
    expect(screen.getByText('exporter.yaml')).toBeInTheDocument();
    expect(screen.getByText('remote.yaml')).toBeInTheDocument();
    expect(screen.getByText(/model: 'netio'/)).toBeInTheDocument();

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
});
