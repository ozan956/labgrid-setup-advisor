import { useState } from 'react';
import { catalog, definitions } from './data';
import { DecisionEngine } from './engine/decision-engine';
import type { Answers, UseCaseDefinition } from './engine/types';
import { Icon } from './components/Icons';
import { Results } from './components/Results';
import { UseCaseCatalog } from './components/UseCaseCatalog';
import { Wizard } from './components/Wizard';

type Screen = 'landing' | 'catalog' | 'wizard' | 'results';

function Landing({ onStart }: { onStart: () => void }) {
  return (
    <main id="main-content">
      <section className="hero page-shell">
        <div className="hero-copy">
          <div className="eyebrow"><span /> Deterministic setup guidance</div>
          <h1>From your hardware and goals to a working <em>Labgrid setup.</em></h1>
          <p>Answer a few concrete questions. Get verified resources, drivers, architecture guidance, and configuration templates—without guessing at Labgrid's building blocks.</p>
          <div className="hero-actions">
            <button className="button primary large" onClick={onStart}>Find My Setup <Icon name="arrow" /></button>
            <a className="button ghost" href="https://labgrid.readthedocs.io/" target="_blank" rel="noreferrer">Read Labgrid docs</a>
          </div>
          <div className="trust-row">
            <span><Icon name="check" /> Static &amp; private</span>
            <span><Icon name="check" /> Upstream-verified names</span>
            <span><Icon name="check" /> No AI or backend</span>
          </div>
        </div>

        <div className="hero-visual" aria-label="Example Labgrid setup path">
          <div className="visual-toolbar"><i /><i /><i /><span>setup-path.yaml</span></div>
          <div className="signal-path">
            <div className="signal-node is-active"><small>01 / GOAL</small><strong>Remote power</strong><span>External 5 V adapter</span></div>
            <div className="signal-line"><b>verified path</b></div>
            <div className="signal-node"><small>02 / RESOURCE</small><strong>NetworkPowerPort</strong><span>model · host · index</span></div>
            <div className="signal-line" />
            <div className="signal-node"><small>03 / DRIVER</small><strong>NetworkPowerDriver</strong><span>PowerProtocol</span></div>
          </div>
          <div className="visual-status"><span className="status-dot" /> Configuration template ready</div>
        </div>
      </section>

      <section className="how-it-works page-shell">
        <div><span>01</span><h2>Describe the load</h2><p>Start with what receives power, not a class name.</p></div>
        <div><span>02</span><h2>Match real hardware</h2><p>Only supported, electrically relevant paths qualify.</p></div>
        <div><span>03</span><h2>Leave with YAML</h2><p>Get separate local, exporter, and client templates.</p></div>
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
      <header className="site-header page-shell">
        <button className="brand" onClick={goHome} aria-label="Labgrid Setup Advisor home">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>LABGRID <b>SETUP ADVISOR</b></span>
        </button>
        <div className="header-meta"><span>OPEN SOURCE</span><a href="https://github.com/labgrid-project/labgrid" target="_blank" rel="noreferrer">Upstream ↗</a></div>
      </header>

      {screen === 'landing' && <Landing onStart={() => setScreen('catalog')} />}
      {screen === 'catalog' && <UseCaseCatalog entries={catalog} onSelect={selectUseCase} />}
      {screen === 'wizard' && definition && (
        <Wizard
          definition={definition}
          answers={answers}
          questionIndex={questionIndex}
          onAnswer={answer}
          onIndexChange={setQuestionIndex}
          onComplete={() => setScreen('results')}
          onExit={() => setScreen('catalog')}
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

