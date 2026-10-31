import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardVerification, GeneratedFile, HardwareCatalog, Insight, Lab, LabBench, LabChecklistStep, LabInsight, Prefill } from '../../bench/types';
import { findBoard, validateBoardPreset } from '../../bench/catalog';
import { benchProfile, labDeviceCount } from '../../bench/lab';
import { buildLabChecklist } from '../../bench/lab-checklist';
import { generateLabFiles, labZipName } from '../../bench/lab-files';
import { analyzeLab, benchLabel, insightsForBench } from '../../bench/lab-insights';
import { prefillForUseCase } from '../../bench/prefill';
import { boardPresetFromProfile, renderBoardPresetYaml } from '../../bench/preset';
import { encodeLabShareHash, summarizeLab } from '../../bench/storage';
import { createZip } from '../../bench/zip';
import { definitions, type CatalogEntry } from '../../data';
import { Icon } from '../Icons';
import { GeneratedFileCard } from '../bench/GeneratedFileCard';
import { CommandLine, CopyButton, TargetBadge, downloadBytes, downloadText } from '../bench/shared';
import { LabCanvas } from './LabCanvas';
import './lab-plan.css';

export interface LabPlanProps {
  lab: Lab;
  catalog: HardwareCatalog;
  /** Available use-case entries, shown as guides for every bench. */
  entries: CatalogEntry[];
  /** True while the lab came from a share link and has not been saved as the user's own lab. */
  shared?: boolean;
  /** Open the editor, optionally on one bench. */
  onEdit: (benchId?: string) => void;
  onOpenGuide: (useCaseId: string, benchId: string) => void;
  onAdoptShared?: () => void;
  onDiscardShared?: () => void;
}

const SEVERITY_LABELS: Record<Insight['severity'], string> = {
  critical: 'Fix before using the files',
  warning: 'Check this',
  info: 'Good to know',
  success: 'Looks good',
};
const SEVERITIES: Insight['severity'][] = ['critical', 'warning', 'info', 'success'];

const VERIFICATION_LABELS: Record<BoardVerification, string> = {
  lab: 'Verified on hardware',
  docs: 'From documentation',
  unverified: 'Imported, not yet reviewed',
};

export const LAB_CHECKLIST_KEY_PREFIX = 'labgrid-advisor-lab-checklist:';

/** One key per lab: the lab name when set, otherwise the sorted bench ids. */
export function labChecklistKey(lab: Lab): string {
  const name = lab.name.trim();
  const stable = name || [...lab.benches.map((bench) => bench.id)].sort().join('+');
  return `${LAB_CHECKLIST_KEY_PREFIX}${stable || 'unnamed'}`;
}

function loadDone(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}

function boardName(bench: LabBench): string {
  return bench.board.name.trim() || 'Unnamed board';
}

function isSecondary(file: GeneratedFile): boolean {
  return file.kind === 'notes' || file.kind === 'profile';
}

/** Files that belong to one bench only; shared files are listed once elsewhere. */
function ownFiles(files: GeneratedFile[], benchId: string): GeneratedFile[] {
  return files.filter((file) => file.benchId === benchId);
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function InsightList({ insights, headingLevel }: { insights: LabInsight[]; headingLevel: 'h3' | 'h4' }) {
  const Heading = headingLevel;
  return (
    <div className="insight-groups">
      {SEVERITIES.map((severity) => {
        const group = insights.filter((insight) => insight.severity === severity);
        if (group.length === 0) return null;
        return (
          <div className={`insight-group severity-${severity}`} key={severity}>
            <Heading>{SEVERITY_LABELS[severity]}</Heading>
            <ul>
              {group.map((insight) => (
                <li className={`insight severity-${severity}`} key={`${insight.benchId ?? 'lab'}:${insight.id}`}>
                  <strong>{insight.title}</strong>
                  <p>{insight.detail}</p>
                  {insight.command && <CommandLine command={insight.command} />}
                  {insight.docs && insight.docs.length > 0 && (
                    <p className="insight-docs">
                      {insight.docs.map((doc) => <a key={doc.url} href={doc.url} target="_blank" rel="noreferrer">{doc.title} ↗</a>)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function FileStack({ files }: { files: GeneratedFile[] }) {
  const primary = files.filter((file) => !isSecondary(file));
  const secondary = files.filter(isSecondary);
  return (
    <div className="configuration-stack">
      {primary.map((file) => <GeneratedFileCard key={file.filename} file={file} />)}
      {secondary.map((file) => <GeneratedFileCard key={file.filename} file={file} collapsed />)}
    </div>
  );
}

interface GuidesProps {
  entries: CatalogEntry[];
  prefills: Map<string, Prefill>;
  benchId: string;
  benchName?: string;
  onOpenGuide: (useCaseId: string, benchId: string) => void;
}

function Guides({ entries, prefills, benchId, benchName, onOpenGuide }: GuidesProps) {
  const relevant = entries.filter((entry) => prefills.get(entry.id)?.relevance);
  const others = entries.filter((entry) => !prefills.get(entry.id)?.relevance);
  const suffix = benchName ? ` for ${benchName}` : '';
  return (
    <>
      {relevant.length > 0 && (
        <div className="guide-grid">
          {relevant.map((entry) => (
            <article className="use-case-card" key={entry.id}>
              <h4>{entry.title}</h4>
              <p className="guide-relevance">{prefills.get(entry.id)?.relevance}</p>
              <p>{entry.description}</p>
              <button className="card-action" onClick={() => onOpenGuide(entry.id, benchId)} aria-label={`Open ${entry.title} with my answers${suffix}`}>
                Open with my answers <Icon name="arrow" />
              </button>
            </article>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <details className="other-guides">
          <summary>Other guides ({others.length})</summary>
          <div className="guide-grid">
            {others.map((entry) => (
              <article className="use-case-card" key={entry.id}>
                <h4>{entry.title}</h4>
                <p>{entry.description}</p>
                <button className="card-action" onClick={() => onOpenGuide(entry.id, benchId)} aria-label={`Open ${entry.title} guide${suffix}`}>
                  Open guide <Icon name="arrow" />
                </button>
              </article>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

function ContributeCard({ lab, bench, catalog }: { lab: Lab; bench: LabBench; catalog: HardwareCatalog }) {
  const profile = useMemo(() => benchProfile(lab, bench), [lab, bench]);
  const preset = useMemo(() => boardPresetFromProfile(profile, catalog), [profile, catalog]);
  const yaml = useMemo(() => renderBoardPresetYaml(preset), [preset]);
  const errors = useMemo(() => validateBoardPreset(preset), [preset]);
  const filename = `board-${preset.id}.yaml`;
  return (
    <article className="config-card generated-file" aria-label={`Board preset (${filename})`}>
      <header>
        <div>
          <span className="file-kind preset">preset</span>
          <h4>Board preset for the hardware catalog</h4>
          <code>{filename}</code>
          <TargetBadge target="anywhere" />
        </div>
        <div className="file-actions">
          <CopyButton text={yaml} label="Copy" ariaLabel={`Copy ${filename}`} />
          <button
            className="copy-button"
            type="button"
            onClick={() => downloadText(filename, yaml)}
            aria-label={`Download ${filename}`}
            title={`Download ${filename}`}
          >
            <Icon name="download" /> Download
          </button>
        </div>
      </header>
      <p className="file-description">
        The entry is marked <code>verification: lab</code>, which tells readers this bench really ran, so share it only after the checklist passed.
        Paste it under <code>boards:</code> in <code>src/data/hardware/boards.yaml</code> of the advisor repository and open a pull request, or send the file to the repository maintainer.
      </p>
      {errors.length > 0 ? (
        <div className="template-notice">
          <strong>Fix before sharing</strong>
          <span>{errors.join('; ')}</span>
        </div>
      ) : (
        <div className="ready-notice"><Icon name="check" /> Passes the catalog schema</div>
      )}
      <pre tabIndex={0}><code>{yaml}</code></pre>
    </article>
  );
}

interface StepListProps {
  steps: LabChecklistStep[];
  done: Set<string>;
  start: number;
  label: string;
  onToggle: (id: string) => void;
}

function StepList({ steps, done, start, label, onToggle }: StepListProps) {
  return (
    <ol className="checklist" aria-label={label} start={start}>
      {steps.map((step) => (
        <li className={`checklist-step ${done.has(step.id) ? 'is-done' : ''}`} key={step.id}>
          <label className="checklist-title">
            <input type="checkbox" checked={done.has(step.id)} onChange={() => onToggle(step.id)} />
            <span>{step.title}</span>
            <TargetBadge target={step.target} />
          </label>
          <p>{step.detail}</p>
          {step.commands && step.commands.length > 0 && (
            <div className="checklist-commands">
              {step.commands.map((command) => <CommandLine key={command} command={command} />)}
            </div>
          )}
          {step.docs && step.docs.length > 0 && (
            <p className="insight-docs">{step.docs.map((doc) => <a key={doc.url} href={doc.url} target="_blank" rel="noreferrer">{doc.title} ↗</a>)}</p>
          )}
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function LabPlan({ lab, catalog, entries, shared = false, onEdit, onOpenGuide, onAdoptShared, onDiscardShared }: LabPlanProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [shareState, setShareState] = useState('Copy share link');
  const [shareFallback, setShareFallback] = useState<string>();
  const [selectedBenchId, setSelectedBenchId] = useState<string>();

  const files = useMemo(() => generateLabFiles(lab, catalog), [lab, catalog]);
  const insights = useMemo(() => analyzeLab(lab, catalog), [lab, catalog]);
  const steps = useMemo(() => buildLabChecklist(lab, catalog, files), [lab, catalog, files]);
  const prefills = useMemo(() => {
    const result = new Map<string, Map<string, Prefill>>();
    for (const bench of lab.benches) {
      const profile = benchProfile(lab, bench);
      const perBench = new Map<string, Prefill>();
      if (bench.devices.length > 0) {
        for (const [id, definition] of definitions) perBench.set(id, prefillForUseCase(profile, definition, catalog));
      }
      result.set(bench.id, perBench);
    }
    return result;
  }, [lab, catalog]);

  const checklistKey = labChecklistKey(lab);
  const [done, setDone] = useState<Set<string>>(() => loadDone(checklistKey));

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    setDone(loadDone(checklistKey));
  }, [checklistKey]);

  function toggleStep(id: string): void {
    const next = new Set(done);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    try {
      window.localStorage.setItem(checklistKey, JSON.stringify([...next]));
    } catch {
      // Storage may be unavailable; the state still updates for this visit.
    }
    setDone(next);
  }

  function shareLink(): string {
    return `${window.location.origin}${window.location.pathname}${encodeLabShareHash(lab)}`;
  }

  async function copyShareLink(): Promise<void> {
    const link = shareLink();
    try {
      await navigator.clipboard.writeText(link);
      setShareFallback(undefined);
      setShareState('Link copied');
    } catch {
      setShareFallback(link);
      setShareState('Copy failed; select the link below');
    }
    window.setTimeout(() => setShareState('Copy share link'), 2400);
  }

  function downloadBundle(): void {
    const archive = createZip(files.map((file) => ({ name: file.filename, content: file.content })));
    downloadBytes(labZipName(lab), archive);
  }

  function focusBench(benchId: string): void {
    setSelectedBenchId(benchId);
    const section = document.getElementById(`bench-${benchId}`);
    if (!section) return;
    section.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    section.focus({ preventScroll: true });
  }

  const single = lab.benches.length === 1;
  const noun = single ? 'bench' : 'lab';
  const labName = lab.name.trim();
  const title = labName ? `${labName} plan` : single ? 'Your bench plan' : 'Your lab plan';
  const deviceCount = labDeviceCount(lab);
  const sharedFiles = files.filter((file) => file.benchId === undefined);
  const labInsights = insightsForBench(insights, undefined);
  const sharedSteps = steps.filter((step) => step.benchId === undefined && step.id !== 'verify');
  const verifySteps = steps.filter((step) => step.id === 'verify');
  const doneCount = steps.filter((step) => done.has(step.id)).length;
  const [onlyBench] = lab.benches;

  return (
    <main id="main-content" className="plan-page lab-plan page-shell">
      {shared && (
        <section className="shared-strip" aria-label={`Shared ${noun}`}>
          <div>
            <strong>You are viewing a shared {noun}.</strong>
            <p>It is not saved yet. Save it to make it your {noun}, or discard it to keep what you had.</p>
          </div>
          <div className="bench-strip-actions">
            <button className="button primary" onClick={onAdoptShared}>Save as my {noun}</button>
            <button className="button secondary" onClick={onDiscardShared}>Discard</button>
          </div>
        </section>
      )}

      <section className="results-hero">
        <div>
          <div className="section-kicker">{single ? 'Your bench plan' : 'Your lab plan'}</div>
          <h1 ref={headingRef} tabIndex={-1}>{title}</h1>
          <p className="plan-summary">{summarizeLab(lab, catalog)}</p>
          <p className="plan-meta">
            {lab.benches.length} {single ? 'bench' : 'benches'} · {deviceCount} {deviceCount === 1 ? 'device' : 'devices'} · {lab.topology === 'remote' ? 'remote, through a coordinator' : 'local, on this computer'}
          </p>
          <p>Files below already contain your values. Follow the checklist in order; each step says on which machine it runs.</p>
        </div>
        <div className="plan-actions">
          <button className="button primary" onClick={downloadBundle}><Icon name="download" /> Download bundle (.zip)</button>
          <button className="button secondary" onClick={() => onEdit()}>Edit {noun}</button>
          <button className="text-button" onClick={copyShareLink}>{shareState}</button>
          <button className="text-button" onClick={() => downloadText('lab-profile.json', JSON.stringify(lab, null, 2), 'application/json')}>Export JSON</button>
          <span className="visually-hidden" role="status" aria-live="polite">{shareState === 'Copy share link' ? '' : shareState}</span>
          {shareFallback && (
            <div className="share-fallback">
              <label htmlFor="share-link">Share link</label>
              <input id="share-link" readOnly value={shareFallback} onFocus={(event) => event.target.select()} />
            </div>
          )}
        </div>
      </section>

      <section className="result-section" aria-labelledby="diagram-heading">
        <div className="result-section-heading">
          <div>
            <h2 id="diagram-heading">How it fits together</h2>
            <p>{single ? 'Each block is a machine, service or device in your setup.' : 'Each tile is a bench; click a board to jump to its files and steps.'}</p>
          </div>
        </div>
        <LabCanvas lab={lab} catalog={catalog} readOnly selectedBenchId={selectedBenchId} onSelectBench={focusBench} />
      </section>

      <section className="result-section" aria-labelledby="insights-heading">
        <div className="result-section-heading">
          <div><h2 id="insights-heading">What to know about your hardware</h2><p>Advice derived from the devices, boards and topology you described.</p></div>
        </div>
        {insights.length === 0 ? (
          <p className="section-copy">Nothing to flag for this {noun}.</p>
        ) : single ? (
          <InsightList insights={insights} headingLevel="h3" />
        ) : (
          <div className="lab-insight-sections">
            {labInsights.length > 0 && (
              <div className="lab-insight-section">
                <h3 className="lab-subheading">Whole lab</h3>
                <InsightList insights={labInsights} headingLevel="h4" />
              </div>
            )}
            {lab.benches.map((bench) => {
              const own = insightsForBench(insights, bench.id);
              if (own.length === 0) return null;
              return (
                <div className="lab-insight-section" key={bench.id}>
                  <h3 className="lab-subheading"><a href={`#bench-${bench.id}`} onClick={(event) => { event.preventDefault(); focusBench(bench.id); }}>{benchLabel(bench)}</a> <span className="lab-subheading-meta">{bench.place}</span></h3>
                  <InsightList insights={own} headingLevel="h4" />
                </div>
              );
            })}
          </div>
        )}
      </section>

      {single ? (
        <section className="result-section" aria-labelledby="files-heading">
          <div className="result-section-heading">
            <div><h2 id="files-heading">Your files</h2><p>Copy or download each file to the machine named on its badge.</p></div>
          </div>
          <FileStack files={[...ownFiles(files, onlyBench.id), ...sharedFiles]} />
        </section>
      ) : (
        <section className="result-section" aria-labelledby="files-heading">
          <div className="result-section-heading">
            <div><h2 id="files-heading">Shared files</h2><p>{lab.topology === 'remote' ? 'One exporter configuration carries every bench; the per-bench client files are listed under each bench.' : 'Notes and the lab profile for the whole lab; the per-bench environments are listed under each bench.'}</p></div>
          </div>
          <FileStack files={sharedFiles} />
        </section>
      )}

      {lab.benches.map((bench) => {
        const preset = bench.board.presetId ? findBoard(catalog, bench.board.presetId) : undefined;
        const benchFiles = ownFiles(files, bench.id);
        const benchPrefills = prefills.get(bench.id) ?? new Map<string, Prefill>();
        const hasBoardName = bench.board.name.trim().length > 0;
        return (
          <section
            className={`result-section lab-bench-section${single ? ' single' : ''}`}
            id={`bench-${bench.id}`}
            key={bench.id}
            tabIndex={-1}
            aria-labelledby={`bench-${bench.id}-heading`}
          >
            <div className="result-section-heading lab-bench-heading">
              <div>
                {single ? (
                  <h2 id={`bench-${bench.id}-heading`}>Guides for your bench</h2>
                ) : (
                  <h2 id={`bench-${bench.id}-heading`}>
                    {boardName(bench)}
                    {preset && <span className={`verification-badge verification-${preset.verification}`}>{VERIFICATION_LABELS[preset.verification]}</span>}
                  </h2>
                )}
                <p>
                  {single
                    ? 'Each guide opens with answers taken from your bench. Change any answer you disagree with.'
                    : <>Place <code>{bench.place.trim() || 'unnamed'}</code>{bench.group.trim() && bench.group.trim() !== bench.place.trim() ? <> · group <code>{bench.group}</code></> : null} · {bench.devices.length} {bench.devices.length === 1 ? 'device' : 'devices'}</>}
                </p>
              </div>
              {!single && <button className="button secondary" onClick={() => onEdit(bench.id)}>Edit this bench</button>}
            </div>

            {!single && benchFiles.length > 0 && (
              <div className="lab-bench-block">
                <h3 className="lab-subheading">Files for this bench</h3>
                <FileStack files={benchFiles} />
              </div>
            )}

            <div className="lab-bench-block">
              {!single && <h3 className="lab-subheading">Guides</h3>}
              {bench.devices.length === 0 ? (
                <p className="section-copy">Add devices to this bench to get guides with your answers filled in.</p>
              ) : (
                <Guides entries={entries} prefills={benchPrefills} benchId={bench.id} benchName={single ? undefined : boardName(bench)} onOpenGuide={onOpenGuide} />
              )}
            </div>

            {hasBoardName && (
              <div className="lab-bench-block">
                <h3 className="lab-subheading" id={`contribute-${bench.id}-heading`}>Contribute this board</h3>
                <p className="section-copy">Turn this bench into a board preset so the next person with this board starts from facts that ran in a lab.</p>
                <ContributeCard lab={lab} bench={bench} catalog={catalog} />
              </div>
            )}
          </section>
        );
      })}

      <section className="result-section" aria-labelledby="checklist-heading">
        <div className="result-section-heading">
          <div><h2 id="checklist-heading">Step by step</h2><p className="checklist-progress" aria-live="polite">{doneCount} of {steps.length} done</p></div>
        </div>
        {single ? (
          <StepList steps={steps} done={done} start={1} label="Setup steps" onToggle={toggleStep} />
        ) : (
          <div className="lab-checklist-groups">
            {sharedSteps.length > 0 && (
              <div className="lab-checklist-group">
                <h3 className="lab-subheading">Once for the lab</h3>
                <StepList steps={sharedSteps} done={done} start={1} label="Shared setup steps" onToggle={toggleStep} />
              </div>
            )}
            {(() => {
              let offset = sharedSteps.length;
              return lab.benches.map((bench) => {
                const own = steps.filter((step) => step.benchId === bench.id);
                if (own.length === 0) return null;
                const start = offset + 1;
                offset += own.length;
                return (
                  <div className="lab-checklist-group" key={bench.id}>
                    <h3 className="lab-subheading">{benchLabel(bench)} <span className="lab-subheading-meta">{bench.place}</span></h3>
                    <StepList steps={own} done={done} start={start} label={`Setup steps for ${benchLabel(bench)}`} onToggle={toggleStep} />
                  </div>
                );
              });
            })()}
            {verifySteps.length > 0 && (
              <div className="lab-checklist-group">
                <h3 className="lab-subheading">Finally</h3>
                <StepList steps={verifySteps} done={done} start={steps.length - verifySteps.length + 1} label="Final checks" onToggle={toggleStep} />
              </div>
            )}
          </div>
        )}
      </section>

      <section className="lab-plan-footer" aria-label="Plan actions">
        <button className="button secondary" onClick={() => onEdit()}>Edit {noun}</button>
        <button className="text-button" onClick={downloadBundle}><Icon name="download" /> Download bundle (.zip)</button>
      </section>
    </main>
  );
}
