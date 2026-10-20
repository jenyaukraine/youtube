import { useCallback, useEffect, useRef, useState } from 'react';
import { Automation } from './components/Automation';
import { StartForm } from './components/StartForm';
import { WorkersPanel } from './components/WorkersPanel';
import { ChromeWorkspace } from './components/ChromeWorkspace';
import { ScenariosPage } from './pages/ScenariosPage';
import { listMacros, localScenarios, ownedJob } from './lib/api';
import { useLive } from './lib/live';
import type { Macro, Scenario } from './lib/types';

function Toast() {
  const [t, setT] = useState<{ msg: string; type: string } | null>(null);
  const timer = useRef<number>();
  useEffect(() => {
    const on = (e: Event) => { setT((e as CustomEvent).detail); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setT(null), 3200); };
    window.addEventListener('katya-toast', on); return () => window.removeEventListener('katya-toast', on);
  }, []);
  return <div className={'toast' + (t ? ' show ' + t.type : '')}>{t?.msg}</div>;
}

export default function App() {
  const { state, online } = useLive();
  const [scenarios, setScenarios] = useState<Scenario[]>(localScenarios());
  const [macros, setMacros] = useState<Macro[]>([]);
  const [mode, setMode] = useState<'playwright' | 'chrome'>(() => localStorage.getItem('katya_launch_method') === 'chrome' ? 'chrome' : 'playwright');
  const changeMode = (next: 'playwright' | 'chrome') => { localStorage.setItem('katya_launch_method', next); setMode(next); };
  const refreshMacros = useCallback(async () => { const r = await listMacros(); setMacros(r.macros || []); }, []);
  const refreshScenarios = useCallback(() => setScenarios(localScenarios()), []);
  useEffect(() => { refreshMacros(); }, [refreshMacros]);

  const running = state.jobs.filter(j => j.status === 'running');
  const tabs = running.flatMap(j => j.workers_list.filter(w => w.state !== 'stopped').map(w => ({ job: j, worker: w })));
  const own = ownedJob(state.jobs);

  return (
    <div className="wrap">
      <header>
        <div className="brand">
          <div className="logo"><svg viewBox="0 0 24 24" fill="none" stroke="#8fe3a2" strokeWidth="2" strokeLinecap="round"><path d="M3 12h4l2-7 4 14 2-7h6" /></svg></div>
          <div><h1>Katya <span>Browser Lab</span></h1><p>Вкладки, сценарии и действия в одном месте</p></div>
        </div>
      </header>

      <>
          {mode === 'chrome' ? <ChromeWorkspace scenarios={scenarios} macros={macros} onBack={() => changeMode('playwright')} onScenariosChanged={() => { refreshScenarios(); refreshMacros(); }} /> : <div className="grid">
            <StartForm jobs={state.jobs} scenarios={scenarios} macros={macros} ownJob={own} onChrome={() => changeMode('chrome')} />
            <div className="card">
              <h2>Вкладки</h2>
              <details className="scenarios-inline"><summary>Сохранённые сценарии · {scenarios.length + macros.length}</summary><ScenariosPage scenarios={scenarios} macros={macros} onChanged={refreshScenarios} onMacrosChanged={refreshMacros} onStarted={() => undefined} /></details>
              <WorkersPanel tabs={tabs} jobs={state.jobs} online={online} scenarios={scenarios} macros={macros} memoryPercent={state.system.memory_percent}
                onScenariosChanged={() => { refreshScenarios(); refreshMacros(); }} />
            </div>
          </div>}
          {mode === 'playwright' && <>
            <details className="diagnostics"><summary>Диагностика сервера</summary><div className="system-foot"><span>CPU <b>{state.system.cpu_percent}%</b></span><span>RAM <b>{state.system.memory_percent}%</b></span><span>Процессов Chrome <b>{state.system.chromium_processes}</b></span></div><div className="log">{state.log.slice(-60).map((l, i) => <div className="l" key={i}>{l}</div>)}</div></details>
            <details className="automation-section"><summary>Триггеры, макросы и файлы</summary><Automation jobs={state.jobs} triggers={state.triggers || []} macros={macros} onMacrosChanged={refreshMacros} /></details>
          </>}
      </>
      <Toast />
    </div>
  );
}
