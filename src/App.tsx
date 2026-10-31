import { useEffect, useMemo, useState } from 'react';
import { hardwareCatalog } from './bench/catalog';
import { benchProfile, emptyLab, findBench, labDeviceCount, labFromProfile } from './bench/lab';
import { applyPrefill, prefillForUseCase } from './bench/prefill';
import { sampleBenches, type SampleBench } from './bench/samples';
import { clearLab, decodeLabShareHash, hasShareHash, loadLab, saveLab } from './bench/storage';
import type { Lab, Prefill } from './bench/types';
import { BenchPlan, CHECKLIST_KEY_PREFIX } from './components/bench/BenchPlan';
import { Icon } from './components/Icons';
import { LabCanvas } from './components/lab/LabCanvas';
import { LabEditor } from './components/lab/LabEditor';
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
  lab?: Lab;
  /** The lab came from a share link and is not saved yet. */
  shared: boolean;
  /** A share hash was present but could not be decoded. */
  shareError: boolean;
}

/** Pure: reads the URL and storage without side effects so StrictMode double calls are harmless. */
function initialState(): InitialState {
  const hash = window.location.hash;
  const hasHash = hasShareHash(hash);
  const shared = hasHash ? decodeLabShareHash(hash) : undefined;
  if (shared) return { lab: shared, shared: true, shareError: false };
  return { lab: loadLab(), shared: false, shareError: hasHash };
}

function clearChecklists(): void {
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(CHECKLIST_KEY_PREFIX)) keys.push(key);
  }
  for (const key of keys) window.localStorage.removeItem(key);
}

/** The bench to show: the requested one, else the first bench that has devices, else the first. */
function pickBench(lab: Lab, preferredId: string | undefined): string {
  const preferred = preferredId ? findBench(lab, preferredId) : undefined;
  if (preferred) return preferred.id;
  return (lab.benches.find((bench) => bench.devices.length > 0) ?? lab.benches[0]).id;
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(preferredTheme);
  const [initial] = useState(initialState);
  const [screen, setScreen] = useState<Screen>(initial.shared ? 'plan' : 'landing');
  const [lab, setLab] = useState<Lab | undefined>(initial.lab);
  const [activeBenchId, setActiveBenchId] = useState<string | undefined>(initial.lab ? pickBench(initial.lab, undefined) : undefined);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>();
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
    if ((initial.shared || initial.shareError) && hasShareHash(window.location.hash)) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  }, [initial]);

  const activeBench = lab ? (findBench(lab, activeBenchId ?? '') ?? lab.benches[0]) : undefined;
  const profile = useMemo(() => (lab && activeBench ? benchProfile(lab, activeBench) : undefined), [lab, activeBench]);

  const prefills = useMemo(() => {
    const map = new Map<string, Prefill>();
    if (!profile || profile.devices.length === 0) return map;
    for (const [id, item] of definitions) map.set(id, prefillForUseCase(profile, item, hardwareCatalog));
    return map;
  }, [profile]);

  const hasBench = lab !== undefined && labDeviceCount(lab) > 0;
  const manyBenches = lab !== undefined && lab.benches.length > 1;

  function changeLab(next: Lab): void {
    setLab(next);
    // Editing a shared lab adopts it.
    setShared(false);
    saveLab(next);
  }

  function selectBench(benchId: string): void {
    setActiveBenchId(benchId);
    setSelectedDeviceId(undefined);
  }

  function selectDevice(benchId: string, deviceId: string): void {
    setActiveBenchId(benchId);
    setSelectedDeviceId(deviceId);
  }

  function adoptShared(): void {
    if (lab) saveLab(lab);
    setShared(false);
  }

  function discardShared(): void {
    const saved = loadLab();
    setShared(false);
    setLab(saved);
    setActiveBenchId(saved ? pickBench(saved, undefined) : undefined);
    setScreen(saved && labDeviceCount(saved) > 0 ? 'plan' : 'landing');
  }

  function goHome(): void {
    setScreen('landing');
    setNotice(undefined);
  }

  function openBench(): void {
    if (!lab) {
      const fresh = emptyLab();
      setLab(fresh);
      setActiveBenchId(fresh.benches[0].id);
    }
    setNotice(undefined);
    setScreen('bench');
  }

  function openPlan(): void {
    if (hasBench && lab) {
      // The plan page shows one bench; prefer one that has devices.
      if (activeBench && activeBench.devices.length === 0) setActiveBenchId(pickBench(lab, undefined));
      setScreen('plan');
    } else {
      openBench();
    }
  }

  function resetLab(): void {
    clearLab();
    clearChecklists();
    setShared(false);
    const fresh = emptyLab();
    setLab(fresh);
    setActiveBenchId(fresh.benches[0].id);
    setSelectedDeviceId(undefined);
  }

  function loadSample(sample: SampleBench): void {
    const next = labFromProfile(structuredClone(sample.profile));
    changeLab(next);
    setActiveBenchId(next.benches[0].id);
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
            <button className="header-link" onClick={openPlan}>{manyBenches ? 'My lab' : 'My bench'}</button>
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
          lab={lab}
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
      {screen === 'bench' && lab && activeBench && (
        <LabEditor
          lab={lab}
          catalog={hardwareCatalog}
          activeBenchId={activeBench.id}
          selectedDeviceId={selectedDeviceId}
          onChange={changeLab}
          onSelectBench={selectBench}
          onSelectDevice={selectDevice}
          onPlan={() => setScreen('plan')}
          onReset={resetLab}
          onExit={goHome}
          canvas={(announce) => (
            <LabCanvas
              lab={lab}
              catalog={hardwareCatalog}
              selectedBenchId={activeBench.id}
              selectedDeviceId={selectedDeviceId}
              onSelectBench={selectBench}
              onSelectDevice={selectDevice}
              onChange={changeLab}
              onAnnounce={announce}
            />
          )}
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
