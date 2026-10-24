import { useState } from 'react';
import { catalog, definitions, type CatalogEntry } from './data';
import { DecisionEngine } from './engine/decision-engine';
import type { Answers, UseCaseDefinition } from './engine/types';
import { Icon } from './components/Icons';
import { Results } from './components/Results';
import { UseCaseCatalog } from './components/UseCaseCatalog';
import { Wizard } from './components/Wizard';

type Screen = 'landing' | 'wizard' | 'results';

function Landing({ entries, onSelect }: { entries: CatalogEntry[]; onSelect: (id: string) => void }) {
  return (
    <main id="main-content" className="landing-page page-shell">
      <section className="hero">
        <h1>Labgrid Setup Advisor</h1>
        <div className="docs-notice" role="note">
          <strong><Icon name="check" /> Deterministic setup guidance</strong>
          <p>From your hardware and goals to a working Labgrid setup.</p>
        </div>
        <p>Answer a few concrete questions to get verified resources, drivers, architecture guidance, and configuration templates—without guessing at Labgrid's building blocks.</p>
      </section>

      <UseCaseCatalog entries={entries} onSelect={onSelect} />

      <section className="how-it-works">
        <h2>How it works</h2>
        <div className="how-grid">
          <div><h3>Describe your goal</h3><p>Start with the outcome you need, not a class name.</p></div>
          <div><h3>Match real hardware</h3><p>Choose only components supported by upstream Labgrid.</p></div>
          <div><h3>Leave with YAML</h3><p>Get local, exporter, or client templates for your path.</p></div>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('landing');
  const [definition, setDefinition] = useState<UseCaseDefinition>();
  const [answers, setAnswers] = useState<Answers>({});
  const [questionIndex, setQuestionIndex] = useState(0);

  function goHome(): void {
    setScreen('landing');
    setDefinition(undefined);
    setAnswers({});
    setQuestionIndex(0);
  }

  function selectUseCase(id: string): void {
    const selected = definitions.get(id);
    if (!selected) return;
    setDefinition(selected);
    setAnswers({});
    setQuestionIndex(0);
    setScreen('wizard');
  }

  function answer(questionId: string, value: string): void {
    if (!definition) return;
    setAnswers((current) => new DecisionEngine(definition).setAnswer(current, questionId, value));
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="site-header">
        <div className="header-inner page-shell">
          <button className="brand" onClick={goHome} aria-label="Labgrid Setup Advisor home">
            <span className="brand-mark"><i /><i /><i /></span>
            <span>LABGRID</span>
          </button>
          <div className="header-context">
            <span className="context-pill">Setup Advisor <Icon name="arrow" /></span>
            <span>Hardware automation</span>
          </div>
          <div className="header-meta">
            <a href="https://github.com/labgrid-project/labgrid" target="_blank" rel="noreferrer">GitHub ↗</a>
            <a href="https://labgrid.readthedocs.io/" target="_blank" rel="noreferrer">Documentation</a>
          </div>
        </div>
      </header>

      {screen === 'landing' && <Landing entries={catalog} onSelect={selectUseCase} />}
      {screen === 'wizard' && definition && (
        <Wizard
          definition={definition}
          answers={answers}
          questionIndex={questionIndex}
          onAnswer={answer}
          onIndexChange={setQuestionIndex}
          onComplete={() => setScreen('results')}
          onExit={() => setScreen('landing')}
        />
      )}
      {screen === 'results' && definition && (
        <Results
          definition={definition}
          answers={answers}
          onEdit={() => { setQuestionIndex(0); setScreen('wizard'); }}
          onRestart={() => { setAnswers({}); setQuestionIndex(0); setScreen('wizard'); }}
        />
      )}

      <footer className="site-footer page-shell">
        <span>Labgrid Setup Advisor</span>
        <span>Definitions target Labgrid <code>v26.0-216-geb05ee67</code></span>
      </footer>
    </div>
  );
}
