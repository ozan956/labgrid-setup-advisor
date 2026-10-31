import { useEffect, useMemo, useState } from 'react';
import { hardwareCatalog } from './bench/catalog';
import { applyPrefill, prefillForUseCase } from './bench/prefill';
import { emptyProfile } from './bench/profile';
import { sampleBenches, type SampleBench } from './bench/samples';
import { clearProfile, decodeShareHash, loadProfile, saveProfile } from './bench/storage';
import type { BenchProfile, Prefill } from './bench/types';
import { BenchEditor } from './components/bench/BenchEditor';
import { BenchPlan } from './components/bench/BenchPlan';
import { Icon } from './components/Icons';
import { Landing } from './components/Landing';
import { Results } from './components/Results';
import { Wizard } from './components/Wizard';
import { catalog, definitions } from './data';
import { DecisionEngine, type PlaceholderValues } from './engine/decision-engine';
import type { Answers, UseCaseDefinition } from './engine/types';

type Screen = 'landing' | 'bench' | 'plan' | 'wizard' | 'results';
type Theme = 'light' | 'dark';

function preferredTheme(): Theme {
  const saved = window.localStorage.getItem('labgrid-advisor-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function initialProfile(): { profile?: BenchProfile; shared: boolean } {
  const shared = decodeShareHash(window.location.hash);
  if (shared) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    return { profile: shared, shared: true };
  }
  return { profile: loadProfile(), shared: false };
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const initial = preferredTheme();
    document.documentElement.dataset.theme = initial;
    return initial;
  });
  const [initial] = useState(initialProfile);
  const [screen, setScreen] = useState<Screen>(initial.shared ? 'plan' : 'landing');
  const [profile, setProfile] = useState<BenchProfile | undefined>(initial.profile);
  const [definition, setDefinition] = useState<UseCaseDefinition>();
  const [answers, setAnswers] = useState<Answers>({});
  const [values, setValues] = useState<PlaceholderValues>({});
  const [prefill, setPrefill] = useState<Prefill>();
  const [questionIndex, setQuestionIndex] = useState(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('labgrid-advisor-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (initial.shared && initial.profile) saveProfile(initial.profile);
  }, [initial]);

  const prefills = useMemo(() => {
    const map = new Map<string, Prefill>();
    if (!profile || profile.devices.length === 0) return map;
    for (const [id, item] of definitions) map.set(id, prefillForUseCase(profile, item, hardwareCatalog));
    return map;
  }, [profile]);

  function updateProfile(next: BenchProfile): void {
    setProfile(next);
    saveProfile(next);
  }

  function goHome(): void {
    setScreen('landing');
    setDefinition(undefined);
    setAnswers({});
    setValues({});
    setPrefill(undefined);
    setQuestionIndex(0);
  }

  function openBench(): void {
    if (!profile) setProfile(emptyProfile());
    setScreen('bench');
  }

  function openPlan(): void {
    if (profile && profile.devices.length > 0) setScreen('plan');
    else openBench();
  }

  function resetBench(): void {
    clearProfile();
    setProfile(emptyProfile());
  }

  function loadSample(sample: SampleBench): void {
    updateProfile(structuredClone(sample.profile));
    setScreen('plan');
  }

  function openUseCase(id: string, jumpWhenComplete: boolean): void {
    const selected = definitions.get(id);
    if (!selected) return;
    const suggestion = prefills.get(id);
    const prefilled = suggestion ? applyPrefill(selected, suggestion.answers) : {};
    const engine = new DecisionEngine(selected);
    setDefinition(selected);
    setPrefill(suggestion);
    setAnswers(prefilled);
    setValues(suggestion ? { ...suggestion.values } : {});
    const visible = engine.visibleQuestions(prefilled);
    const firstOpen = visible.findIndex((question) => prefilled[question.id] === undefined);
    setQuestionIndex(firstOpen === -1 ? 0 : firstOpen);
    if (jumpWhenComplete && engine.answerStatus(prefilled).complete) {
      setScreen('results');
    } else {
      setScreen('wizard');
    }
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
            <button className="header-link" onClick={openPlan}>My bench</button>
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

      {screen === 'landing' && (
        <Landing
          entries={catalog}
          profile={profile}
          catalog={hardwareCatalog}
          prefills={prefills}
          samples={sampleBenches}
          onSelect={(id) => openUseCase(id, false)}
          onDescribe={openBench}
          onViewPlan={openPlan}
          onEditBench={openBench}
          onLoadSample={loadSample}
        />
      )}
      {screen === 'bench' && profile && (
        <BenchEditor
          profile={profile}
          catalog={hardwareCatalog}
          onChange={updateProfile}
          onPlan={() => setScreen('plan')}
          onReset={resetBench}
          onExit={goHome}
        />
      )}
      {screen === 'plan' && profile && (
        <BenchPlan
          profile={profile}
          catalog={hardwareCatalog}
          entries={catalog.filter((entry) => entry.status === 'available')}
          prefills={prefills}
          onEdit={openBench}
          onOpenGuide={(id) => openUseCase(id, true)}
        />
      )}
      {screen === 'wizard' && definition && (
        <Wizard
          definition={definition}
          answers={answers}
          questionIndex={questionIndex}
          prefill={prefill}
          onAnswer={answer}
          onIndexChange={setQuestionIndex}
          onComplete={() => setScreen('results')}
          onExit={() => setScreen(profile && profile.devices.length > 0 && prefill ? 'plan' : 'landing')}
        />
      )}
      {screen === 'results' && definition && (
        <Results
          definition={definition}
          answers={answers}
          values={values}
          prefill={prefill}
          onValuesChange={setValues}
          onEdit={() => { setQuestionIndex(0); setScreen('wizard'); }}
          onRestart={() => { setAnswers({}); setValues({}); setQuestionIndex(0); setScreen('wizard'); }}
        />
      )}

      <footer className="site-footer page-shell">
        <span>Labgrid Setup Advisor</span>
        <span>Definitions target Labgrid <code>v26.0-216-geb05ee67</code></span>
      </footer>
    </div>
  );
}
