import { useEffect, useMemo, useRef, useState } from 'react';
import type { BenchProfile, HardwareCatalog, Insight, Prefill } from '../../bench/types';
import { buildChecklist } from '../../bench/checklist';
import { generateBenchFiles } from '../../bench/generate';
import { analyzeProfile } from '../../bench/insights';
import { encodeShareHash, summarizeProfile } from '../../bench/storage';
import { createZip } from '../../bench/zip';
import type { CatalogEntry } from '../../data';
import { Icon } from '../Icons';
import { BenchDiagram } from './BenchDiagram';
import { GeneratedFileCard } from './GeneratedFileCard';
import { CommandLine, TargetBadge, downloadBytes, downloadText } from './shared';

interface Props {
  profile: BenchProfile;
  catalog: HardwareCatalog;
  entries: CatalogEntry[];
  prefills: Map<string, Prefill>;
  onEdit: () => void;
  onOpenGuide: (useCaseId: string) => void;
}

const SEVERITY_LABELS: Record<Insight['severity'], string> = {
  critical: 'Fix before using the files',
  warning: 'Check this',
  info: 'Good to know',
  success: 'Looks good',
};

function checklistKey(place: string): string {
  return `labgrid-advisor-checklist:${place || 'unnamed'}`;
}

function loadDone(place: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(checklistKey(place));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}

export function BenchPlan({ profile, catalog, entries, prefills, onEdit, onOpenGuide }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [shareState, setShareState] = useState('Copy share link');
  const files = useMemo(() => generateBenchFiles(profile, catalog), [profile, catalog]);
  const insights = useMemo(() => analyzeProfile(profile, catalog), [profile, catalog]);
  const steps = useMemo(() => buildChecklist(profile, catalog, files), [profile, catalog, files]);
  const [done, setDone] = useState<Set<string>>(() => loadDone(profile.names.place));

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    setDone(loadDone(profile.names.place));
  }, [profile.names.place]);

  function toggleStep(id: string): void {
    setDone((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      window.localStorage.setItem(checklistKey(profile.names.place), JSON.stringify([...next]));
      return next;
    });
  }

  async function copyShareLink(): Promise<void> {
    const link = `${window.location.origin}${window.location.pathname}${encodeShareHash(profile)}`;
    try {
      await navigator.clipboard.writeText(link);
      setShareState('Link copied');
      window.setTimeout(() => setShareState('Copy share link'), 1600);
    } catch {
      setShareState('Could not copy');
    }
  }

  function downloadBundle(): void {
    const archive = createZip(files.map((file) => ({ name: file.filename, content: file.content })));
    downloadBytes(`labgrid-bench-${profile.names.place || 'bench'}.zip`, archive);
  }

  const primaryFiles = files.filter((file) => file.kind !== 'notes' && file.kind !== 'profile');
  const secondaryFiles = files.filter((file) => file.kind === 'notes' || file.kind === 'profile');
  const severities: Insight['severity'][] = ['critical', 'warning', 'info', 'success'];
  const relevant = entries.filter((entry) => prefills.get(entry.id)?.relevance);
  const others = entries.filter((entry) => !prefills.get(entry.id)?.relevance);
  const doneCount = steps.filter((step) => done.has(step.id)).length;

  return (
    <main id="main-content" className="plan-page page-shell">
      <section className="results-hero">
        <div>
          <div className="section-kicker">Your bench plan</div>
          <h1 ref={headingRef} tabIndex={-1}>Your bench plan</h1>
          <p className="plan-summary">{summarizeProfile(profile, catalog)}</p>
          <p>Files below already contain your values. Follow the checklist in order; each step says on which machine it runs.</p>
        </div>
        <div className="plan-actions">
          <button className="button primary" onClick={downloadBundle}><Icon name="arrow" /> Download bundle (.zip)</button>
          <button className="button secondary" onClick={onEdit}>Edit bench</button>
          <button className="text-button" onClick={copyShareLink} aria-live="polite">{shareState}</button>
          <button className="text-button" onClick={() => downloadText('bench-profile.json', JSON.stringify(profile, null, 2), 'application/json')}>Export JSON</button>
        </div>
      </section>

      <section className="result-section" aria-labelledby="diagram-heading">
        <div className="result-section-heading">
          <div><h2 id="diagram-heading">How it fits together</h2><p>Each box is a machine, service or device in your setup.</p></div>
        </div>
        <BenchDiagram profile={profile} />
      </section>

      <section className="result-section" aria-labelledby="insights-heading">
        <div className="result-section-heading">
          <div><h2 id="insights-heading">What to know about your hardware</h2><p>Advice derived from the devices, board and topology you described.</p></div>
        </div>
        <div className="insight-groups">
          {severities.map((severity) => {
            const group = insights.filter((insight) => insight.severity === severity);
            if (group.length === 0) return null;
            return (
              <div className={`insight-group severity-${severity}`} key={severity}>
                <h3>{SEVERITY_LABELS[severity]}</h3>
                <ul>
                  {group.map((insight) => (
                    <li className={`insight severity-${severity}`} key={insight.id}>
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
      </section>

      <section className="result-section" aria-labelledby="files-heading">
        <div className="result-section-heading">
          <div><h2 id="files-heading">Your files</h2><p>Copy or download each file to the machine named on its badge.</p></div>
        </div>
        <div className="configuration-stack">
          {primaryFiles.map((file) => <GeneratedFileCard key={file.filename} file={file} />)}
          {secondaryFiles.map((file) => <GeneratedFileCard key={file.filename} file={file} collapsed />)}
        </div>
      </section>

      <section className="result-section" aria-labelledby="checklist-heading">
        <div className="result-section-heading">
          <div><h2 id="checklist-heading">Step by step</h2><p className="checklist-progress">{doneCount} of {steps.length} done</p></div>
        </div>
        <ol className="checklist">
          {steps.map((step) => (
            <li className={`checklist-step ${done.has(step.id) ? 'is-done' : ''}`} key={step.id}>
              <label className="checklist-title">
                <input type="checkbox" checked={done.has(step.id)} onChange={() => toggleStep(step.id)} />
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
      </section>

      <section className="result-section" aria-labelledby="guides-heading">
        <div className="result-section-heading">
          <div><h2 id="guides-heading">Guides for your bench</h2><p>Each guide opens with answers taken from your bench. Change any answer you disagree with.</p></div>
        </div>
        {relevant.length > 0 && (
          <div className="guide-grid">
            {relevant.map((entry) => (
              <article className="use-case-card" key={entry.id}>
                <h3>{entry.title}</h3>
                <p className="guide-relevance">{prefills.get(entry.id)?.relevance}</p>
                <p>{entry.description}</p>
                <button className="card-action" onClick={() => onOpenGuide(entry.id)} aria-label={`Open ${entry.title} with my answers`}>
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
                  <h3>{entry.title}</h3>
                  <p>{entry.description}</p>
                  <button className="card-action" onClick={() => onOpenGuide(entry.id)} aria-label={`Open ${entry.title} with my answers`}>
                    Open guide <Icon name="arrow" />
                  </button>
                </article>
              ))}
            </div>
          </details>
        )}
      </section>
    </main>
  );
}
