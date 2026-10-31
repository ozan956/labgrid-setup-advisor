import { useState } from 'react';
import type { BenchProfile, HardwareCatalog, Prefill } from '../bench/types';
import type { SampleBench } from '../bench/samples';
import { summarizeProfile } from '../bench/storage';
import type { CatalogEntry } from '../data';
import { Icon } from './Icons';
import { UseCaseCatalog } from './UseCaseCatalog';

interface Props {
  entries: CatalogEntry[];
  profile?: BenchProfile;
  catalog: HardwareCatalog;
  prefills: Map<string, Prefill>;
  samples: SampleBench[];
  onSelect: (id: string) => void;
  onDescribe: () => void;
  onViewPlan: () => void;
  onEditBench: () => void;
  onLoadSample: (sample: SampleBench) => void;
}

export function Landing({ entries, profile, catalog, prefills, samples, onSelect, onDescribe, onViewPlan, onEditBench, onLoadSample }: Props) {
  const [showSamples, setShowSamples] = useState(false);
  const hasBench = profile !== undefined && profile.devices.length > 0;

  return (
    <main id="main-content" className="landing-page page-shell">
      {hasBench && profile && (
        <section className="bench-strip" aria-label="Your bench">
          <div>
            <span className="section-kicker">Your bench</span>
            <p>{summarizeProfile(profile, catalog)}</p>
          </div>
          <div className="bench-strip-actions">
            <button className="button primary" onClick={onViewPlan}>View plan</button>
            <button className="button secondary" onClick={onEditBench}>Edit bench</button>
          </div>
        </section>
      )}

      <section className="start-paths" aria-label="Ways to start">
        <article className="start-card primary-path">
          <span className="section-kicker">Recommended</span>
          <h1>Start with your hardware</h1>
          <p>Paste the output of lsusb or labgrid-suggest, pick your board, and get files that already contain your values.</p>
          <div className="start-card-actions">
            <button className="button primary large" onClick={onDescribe}>
              {hasBench ? 'Edit my bench' : 'Describe my bench'} <Icon name="arrow" />
            </button>
            <button className="text-button" onClick={() => setShowSamples((current) => !current)} aria-expanded={showSamples}>
              Try an example bench
            </button>
          </div>
          {showSamples && (
            <ul className="sample-list" aria-label="Example benches">
              {samples.map((sample) => (
                <li key={sample.id}>
                  <button type="button" onClick={() => onLoadSample(sample)}>
                    <strong>{sample.title}</strong>
                    <small>{sample.description}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </article>
        <article className="start-card">
          <span className="section-kicker">Or</span>
          <h2>Start with a goal</h2>
          <p>Pick what the board should do below. Each guide asks a few plain questions and ends with reviewed Labgrid templates.</p>
          <a className="card-action" href="#use-cases">Browse the guides <Icon name="arrow" /></a>
        </article>
      </section>

      <UseCaseCatalog entries={entries} prefills={prefills} onSelect={onSelect} />

      <section className="how-it-works">
        <h2>How it works</h2>
        <div className="how-grid">
          <div><h3>Describe your hardware</h3><p>Paste lsusb or labgrid-suggest output and pick your board. The advisor knows common adapters, probes, hubs and PDUs.</p></div>
          <div><h3>Pick a goal</h3><p>Guides for power, console, flashing, testing and sharing open with answers taken from your bench.</p></div>
          <div><h3>Get files and a checklist</h3><p>Download exporter and environment files with your values plus a step-by-step list that names every command.</p></div>
        </div>
      </section>
    </main>
  );
}
