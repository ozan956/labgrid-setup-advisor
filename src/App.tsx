import { useEffect, useMemo, useState } from 'react';
import { hardwareCatalog } from './bench/catalog';
import { applyPrefill, prefillForUseCase } from './bench/prefill';
import { emptyProfile } from './bench/profile';
import { sampleBenches, type SampleBench } from './bench/samples';
import { clearProfile, decodeShareHash, loadProfile, saveProfile } from './bench/storage';
import type { BenchProfile, Prefill } from './bench/types';
import { BenchEditor } from './components/bench/BenchEditor';
import { BenchPlan, CHECKLIST_KEY_PREFIX } from './components/bench/BenchPlan';
import { Icon } from './components/Icons';
import { Landing } from './components/Landing';
import { Results } from './components/Results';
import { Wizard } from './components/Wizard';
import { catalog, definitions } from './data';
import { DecisionEngine, type PlaceholderValues } from './engine/decision-engine';
import type { Answers, UseCaseDefinition } from './engine/types';

type Screen = 'landing' | 'bench' | 'plan' | 'wizard' | 'results';
type Theme = 'light' | 'dark';
type Origin = 'landing' | 'plan';

const SHARE_ERROR = 'This share link could not be read. Ask for a new link or describe the bench yourself.';

function preferredTheme(): Theme {
  const saved = window.localStorage.getItem('labgrid-advisor-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

interface InitialState {
  profile?: BenchProfile;
  /** The profile came from a share link and is not saved yet. */
  shared: boolean;
  /** A share hash was present but could not be decoded. */
  shareError: boolean;
}

/** Pure: reads the URL and storage without side effects so StrictMode double calls are harmless. */
function initialState(): InitialState {
  const hash = window.location.hash;
  const hasShareHash = /(^#|[#&])bench=/.test(hash);
  const shared = hasShareHash ? decodeShareHash(hash) : undefined;
  if (shared) return { profile: shared, shared: true, shareError: false };
  return { profile: loadProfile(), shared: false, shareError: hasShareHash };
}

function clearChecklists(): void {
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(CHECKLIST_KEY_PREFIX)) keys.push(key);
  }
  for (const key of keys) window.localStorage.removeItem(key);
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(preferredTheme);
  const [initial] = useState(initialState);
  const [screen, setScreen] = useState<Screen>(initial.shared ? 'plan' : 'landing');
  const [profile, setProfile] = useState<BenchProfile | undefined>(initial.profile);
  const [shared, setShared] = useState(initial.shared);
  const [notice, setNotice] = useState<string | undefined>(initial.shareError ? SHARE_ERROR : undefined);
  const [definition, setDefinition] = useState<UseCaseDefinition>();
  const [answers, setAnswers] = useState<Answers>({});
  const [values, setValues] = useState<PlaceholderValues>({});
  const [prefill, setPrefill] = useState<Prefill>();
  const [origin, setOrigin] = useState<Origin>('landing');
  const [questionIndex, setQuestionIndex] = useState(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('labgrid-advisor-theme', theme);
  }, [theme]);

  // Drop the share hash once it has been read so a reload does not re-import it.
  useEffect(() => {
    if ((initial.shared || initial.shareError) && /(^#|[#&])bench=/.test(window.location.hash)) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  }, [initial]);

  const prefills = useMemo(() => {
    const map = new Map<string, Prefill>();
    if (!profile || profile.devices.length === 0) return map;
    for (const [id, item] of definitions) map.set(id, prefillForUseCase(profile, item, hardwareCatalog));
    return map;
  }, [profile]);

  const hasBench = profile !== undefined && profile.devices.length > 0;

  function updateProfile(next: BenchProfile): void {
    setProfile(next);
    // Editing a shared bench adopts it.
    setShared(false);
    saveProfile(next);
  }

  function adoptShared(): void {
    if (profile) saveProfile(profile);
    setShared(false);
  }

  function discardShared(): void {
    const saved = loadProfile();
    setShared(false);
    setProfile(saved);
    setScreen(saved && saved.devices.length > 0 ? 'plan' : 'landing');
  }

  function goHome(): void {
    setScreen('landing');
    setNotice(undefined);
  }

  function openBench(): void {
    if (!profile) setProfile(emptyProfile());
    setNotice(undefined);
    setScreen('bench');
  }

  function openPlan(): void {
    if (hasBench) setScreen('plan');
    else openBench();
  }

  function resetBench(): void {
    clearProfile();
    clearChecklists();
    setShared(false);
    setProfile(emptyProfile());
  }

  function loadSample(sample: SampleBench): void {
    updateProfile(structuredClone(sample.profile));
    setScreen('plan');
  }

  function openUseCase(id: string, from: Origin): void {
    const selected = definitions.get(id);
    if (!selected) return;
    const suggestion = prefills.get(id);
    const engine = new DecisionEngine(selected);
    const sameGuide = definition?.id === id;
    // Re-opening the guide the user was already working on keeps their answers and typed values.
    const prefilled = sameGuide && Object.keys(answers).length > 0
      ? answers
      : suggestion ? applyPrefill(selected, suggestion.answers) : {};
    const nextValues = sameGuide ? { ...(suggestion?.values ?? {}), ...values } : { ...(suggestion?.values ?? {}) };
    setDefinition(selected);
    setPrefill(suggestion);
    setAnswers(prefilled);
    setValues(nextValues);
    setOrigin(from);
    const visible = engine.visibleQuestions(prefilled);
    const firstOpen = visible.findIndex((question) => prefilled[question.id] === undefined);
    setQuestionIndex(firstOpen === -1 ? 0 : firstOpen);
    if (from === 'plan' && engine.answerStatus(prefilled).complete) {
      setScreen('results');
    } else {
      setScreen('wizard');
    }
  }

  function answer(questionId: string, value: string): void {
    if (!definition) return;
    setAnswers((current) => new DecisionEngine(definition).setAnswer(current, questionId, value));
  }

  function exitWizard(): void {
    setScreen(origin === 'plan' && hasBench ? 'plan' : 'landing');
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
          notice={notice}
          onSelect={(id) => openUseCase(id, 'landing')}
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
          shared={shared}
          onEdit={openBench}
          onOpenGuide={(id) => openUseCase(id, 'plan')}
          onAdoptShared={adoptShared}
          onDiscardShared={discardShared}
        />
      )}
      {screen === 'wizard' && definition && (
        <Wizard
          definition={definition}
          answers={answers}
          questionIndex={questionIndex}
          prefill={prefill}
          exitLabel={origin === 'plan' && hasBench ? '← Your bench plan' : '← All setups'}
          onAnswer={answer}
          onIndexChange={setQuestionIndex}
          onComplete={() => setScreen('results')}
          onExit={exitWizard}
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
