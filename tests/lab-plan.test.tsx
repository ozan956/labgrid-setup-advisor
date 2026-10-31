import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hardwareCatalog } from '../src/bench/catalog';
import { labFromProfile } from '../src/bench/lab';
import { sampleLabs } from '../src/bench/lab-samples';
import { sampleBenches } from '../src/bench/samples';
import { LAB_CHECKLIST_KEY_PREFIX, LabPlan, labChecklistKey } from '../src/components/lab/LabPlan';
import { catalog } from '../src/data';

const entries = catalog.filter((entry) => entry.status === 'available');
const rack = sampleLabs.find((sample) => sample.id === 'rack-remote')!.lab;
const desk = sampleLabs.find((sample) => sample.id === 'desk-local')!.lab;
const pi4 = labFromProfile(sampleBenches.find((bench) => bench.id === 'pi4-pdu-remote')!.profile);

function renderPlan(lab = rack, props: Partial<Parameters<typeof LabPlan>[0]> = {}) {
  const onEdit = vi.fn();
  const onOpenGuide = vi.fn();
  const utils = render(
    <LabPlan lab={lab} catalog={hardwareCatalog} entries={entries} onEdit={onEdit} onOpenGuide={onOpenGuide} {...props} />,
  );
  return { ...utils, onEdit, onOpenGuide };
}

describe('lab plan', () => {
  beforeAll(() => {
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });

  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a one-bench lab like the bench plan: diagram, insights, files, guides, contribute card, checklist', () => {
    renderPlan(pi4);
    const heading = screen.getByRole('heading', { level: 1, name: /your bench plan/i });
    expect(heading).toHaveFocus();
    expect(screen.getByRole('group', { name: /lab diagram/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /what to know about your hardware/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^your files$/i })).toBeInTheDocument();
    expect(screen.getAllByRole('article', { name: /\(exporter\.yaml\)$/ })).toHaveLength(1);
    expect(screen.getAllByRole('article', { name: /\(remote\.yaml\)$/ })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: /guides for your bench/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /open .* with my answers$/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole('article', { name: /board preset \(board-raspberry-pi-4-model-b\.yaml\)/i })).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(3);
    expect(screen.getByText(/0 of \d+ done/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^edit bench$/i })).toHaveLength(2);
    expect(screen.queryByText(/shared files/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/once for the lab/i)).not.toBeInTheDocument();
  });

  it('shows one exporter file, per-bench client files and bench sections for a remote lab', () => {
    renderPlan(rack);
    expect(screen.getByRole('heading', { level: 1, name: /rack 3 plan/i })).toBeInTheDocument();
    expect(screen.getByText(/3 benches · 8 devices · remote/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^shared files$/i })).toBeInTheDocument();
    expect(screen.getAllByRole('article', { name: /\(exporter\.yaml\)$/ })).toHaveLength(1);
    for (const place of ['pi4-01', 'imx8mm-01', 'nucleo-01']) {
      expect(screen.getAllByRole('article', { name: new RegExp(`\\(remote-${place}\\.yaml\\)$`) })).toHaveLength(1);
    }
    expect(screen.getByRole('region', { name: /^raspberry pi 4 model b/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /^NXP i\.MX 8M Mini EVK/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /^stm32 nucleo-64/i })).toBeInTheDocument();
    expect(screen.getAllByText(/from documentation/i).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole('heading', { name: /once for the lab/i })).toBeInTheDocument();
    expect(screen.getAllByRole('article', { name: /^board preset \(board-/i })).toHaveLength(3);
  });

  it('opens guides and the editor for the right bench', async () => {
    const user = userEvent.setup();
    const { onEdit, onOpenGuide } = renderPlan(rack);
    const imx = within(screen.getByRole('region', { name: /^NXP i\.MX 8M Mini EVK/i }));
    await user.click(imx.getAllByRole('button', { name: /open .* with my answers for NXP i\.MX 8M Mini EVK/i })[0]);
    expect(onOpenGuide).toHaveBeenCalledWith(expect.any(String), 'bench-2');
    await user.click(imx.getByRole('button', { name: /edit this bench/i }));
    expect(onEdit).toHaveBeenCalledWith('bench-2');
    await user.click(screen.getAllByRole('button', { name: /^edit lab$/i })[0]);
    expect(onEdit).toHaveBeenLastCalledWith();
  });

  it('groups insights by lab and bench and links bench headings to their sections', async () => {
    const user = userEvent.setup();
    renderPlan(rack);
    const insights = screen.getByRole('region', { name: /what to know about your hardware/i });
    expect(within(insights).getByRole('heading', { name: /whole lab/i })).toBeInTheDocument();
    const link = within(insights).getByRole('link', { name: /stm32 nucleo-64/i });
    await user.click(link);
    expect(document.activeElement).toBe(document.getElementById('bench-bench-3'));
  });

  it('focuses a bench section when its board is clicked in the diagram', () => {
    renderPlan(rack);
    fireEvent.click(screen.getByRole('button', { name: /^board raspberry pi 4 model b, place/i }));
    const section = document.getElementById('bench-bench-1');
    expect(section).not.toBeNull();
    expect(document.activeElement).toBe(section);
  });

  it('persists checklist progress per lab and counts it', async () => {
    const user = userEvent.setup();
    const first = renderPlan(rack);
    const boxes = screen.getAllByRole('checkbox');
    const total = boxes.length;
    await user.click(boxes[0]);
    await user.click(boxes[total - 1]);
    expect(screen.getByText(`2 of ${total} done`)).toBeInTheDocument();
    const key = labChecklistKey(rack);
    expect(key).toBe(`${LAB_CHECKLIST_KEY_PREFIX}Rack 3`);
    expect(JSON.parse(window.localStorage.getItem(key) ?? '[]')).toHaveLength(2);
    first.unmount();

    renderPlan(rack);
    const again = screen.getAllByRole('checkbox');
    expect(again[0]).toBeChecked();
    expect(again[total - 1]).toBeChecked();
    expect(again[1]).not.toBeChecked();
    expect(screen.getByText(`2 of ${total} done`)).toBeInTheDocument();
  });

  it('keys unnamed labs by their bench ids', () => {
    expect(labChecklistKey({ ...desk, name: '' })).toBe(`${LAB_CHECKLIST_KEY_PREFIX}bench-1+bench-2`);
    expect(labChecklistKey({ ...desk, name: '', benches: [] })).toBe(`${LAB_CHECKLIST_KEY_PREFIX}unnamed`);
  });

  it('copies a #lab= share link and falls back to a selectable field when the clipboard is unavailable', async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    renderPlan(rack);
    await user.click(screen.getByRole('button', { name: /copy share link/i }));
    expect(write).toHaveBeenCalledWith(expect.stringContaining('#lab='));
    expect(await screen.findByRole('button', { name: /link copied/i })).toBeInTheDocument();

    cleanup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    renderPlan(rack);
    await user.click(screen.getByRole('button', { name: /copy share link/i }));
    const field = (await screen.findByLabelText(/^share link$/i)) as HTMLInputElement;
    expect(field.value).toContain('#lab=');
  });

  it('downloads the bundle and the lab JSON', async () => {
    const user = userEvent.setup();
    renderPlan(desk);
    await user.click(screen.getAllByRole('button', { name: /download bundle/i })[0]);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: /export json/i }));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  });

  it('shows the shared banner with adopt and discard actions', async () => {
    const user = userEvent.setup();
    const onAdoptShared = vi.fn();
    const onDiscardShared = vi.fn();
    renderPlan(rack, { shared: true, onAdoptShared, onDiscardShared });
    expect(screen.getByText(/you are viewing a shared lab/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /save as my lab/i }));
    expect(onAdoptShared).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^discard$/i }));
    expect(onDiscardShared).toHaveBeenCalled();
    cleanup();
    renderPlan(pi4, { shared: true });
    expect(screen.getByText(/you are viewing a shared bench/i)).toBeInTheDocument();
  });

  it('lists per-bench environment files for a local lab', () => {
    renderPlan(desk);
    expect(screen.getByRole('heading', { level: 1, name: /desk plan/i })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: /\(exporter\.yaml\)$/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('article', { name: /\(environment-zcu102-01\.yaml\)$/ })).toHaveLength(1);
    expect(screen.getAllByRole('article', { name: /\(environment-beagleplay-01\.yaml\)$/ }).length + screen.queryAllByRole('article', { name: /\(environment-.*\.yaml\)$/ }).length).toBeGreaterThanOrEqual(2);
  });
});
