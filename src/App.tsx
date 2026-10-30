import { useEffect, useState } from 'react';
import { catalog, definitions, type CatalogEntry } from './data';
import { DecisionEngine } from './engine/decision-engine';
import type { Answers, UseCaseDefinition } from './engine/types';
import { Icon } from './components/Icons';
import { Results } from './components/Results';
import { UseCaseCatalog } from './components/UseCaseCatalog';
import { Wizard } from './components/Wizard';

type Screen = 'landing' | 'wizard' | 'results';
type Theme = 'light' | 'dark';

function preferredTheme(): Theme {
  const saved = window.localStorage.getItem('labgrid-advisor-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function Landing({ entries, onSelect }: { entries: CatalogEntry[]; onSelect: (id: string) => void }) {
  return (
    <main id="main-content" className="landing-page page-shell">
      <UseCaseCatalog entries={entries} onSelect={onSelect} />

      <section className="how-it-works">
        <h2>How it works</h2>
        <div className="how-grid">
          <div><h3>Choose a goal</h3><p>Tell us what the board should do. No Labgrid knowledge is needed.</p></div>
          <div><h3>Answer plain questions</h3><p>Pick what you know. Uncertain choices lead to safe checks, not guesses.</p></div>
          <div><h3>Get next steps</h3><p>See the recommended method first, then open technical details and YAML when ready.</p></div>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const initial = preferredTheme();
    document.documentElement.dataset.theme = initial;
    return initial;
  });
  const [screen, setScreen] = useState<Screen>('landing');
  const [definition, setDefinition] = useState<UseCaseDefinition>();
  const [answers, setAnswers] = useState<Answers>({});
  const [questionIndex, setQuestionIndex] = useState(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('labgrid-advisor-theme', theme);
  }, [theme]);

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
            <span>Labgrid Setup Advisor</span>
          </button>
          <div className="header-meta">
            <button
              className="theme-toggle"
              onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              aria-pressed={theme === 'dark'}
              title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            >
              <Icon name={theme === 'light' ? 'moon' : 'sun'} />
            </button>
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
