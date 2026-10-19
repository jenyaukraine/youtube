import { useCallback, useEffect, useRef, useState } from 'react';
import { Automation } from './components/Automation';
import { StartForm } from './components/StartForm';
import { TabCard } from './components/TabCard';
import { ScenariosPage } from './pages/ScenariosPage';
import { listMacros, localScenarios, ownedJob } from './lib/api';
import { useLive } from './lib/live';
import type { Macro, Scenario } from './lib/types';

type Page = 'tabs' | 'scenarios';

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
  const [page, setPage] = useState<Page>(() => (location.hash === '#scenarios' ? 'scenarios' : 'tabs'));
  const [scenarios, setScenarios] = useState<Scenario[]>(localScenarios());
  const [macros, setMacros] = useState<Macro[]>([]);
  const cpu = useRef<number[]>([]);
  const refreshMacros = useCallback(async () => { const r = await listMacros(); setMacros(r.macros || []); }, []);
  const refreshScenarios = useCallback(() => setScenarios(localScenarios()), []);
  useEffect(() => { refreshMacros(); }, [refreshMacros]);
  useEffect(() => { location.hash = page === 'scenarios' ? '#scenarios' : ''; }, [page]);

  const running = state.jobs.filter(j => j.status === 'running');
  const tabs = running.flatMap(j => j.workers_list.filter(w => w.state !== 'stopped').map(w => ({ job: j, worker: w })));
  const own = ownedJob(state.jobs);
  cpu.current = [...cpu.current, state.system.cpu_percent].slice(-60);
  const points = cpu.current.map((v, i) => `${(i / 59 * 600).toFixed(1)},${(108 - Math.min(100, v) * 1.04).toFixed(1)}`);
  const line = points.length ? 'M' + points.join(' L') : '';
  const errors = tabs.filter(t => t.worker.state === 'error' || t.worker.state === 'blocked').length;

  return (
    <div className="wrap">
      <header>
        <div className="brand">
          <div className="logo"><svg viewBox="0 0 24 24" fill="none" stroke="#8fe3a2" strokeWidth="2" strokeLinecap="round"><path d="M3 12h4l2-7 4 14 2-7h6" /></svg></div>
          <div><h1>Katya <span>Browser Lab</span></h1><p>Вкладки, сценарии и действия в одном месте</p></div>
        </div>
        <div className="header-actions">
          <a href="#" onClick={e => { e.preventDefault(); setPage(page === 'tabs' ? 'scenarios' : 'tabs'); }}>{page === 'tabs' ? 'Сценарии ↗' : '← Вкладки'}</a>
          <div className="badge"><span className={'dot' + (running.length ? ' busy' : '')} /><span>{running.length ? 'работает' : online ? 'онлайн' : 'переподключение…'}</span></div>
        </div>
      </header>

      {page === 'scenarios' ? (
        <ScenariosPage scenarios={scenarios} onChanged={refreshScenarios} onStarted={() => setPage('tabs')} />
      ) : (
        <>
          <div className="goal">
            <div><div className="lbl">Открыто вкладок</div><div className="big">{tabs.length}</div></div>
            <div className="pct"><div className="activity-label">Ошибок</div><div className="activity-value">{errors}</div><div className="activity-sub">CPU {state.system.cpu_percent}% · RAM {state.system.memory_percent}%</div></div>
          </div>
          <div className="grid">
            <StartForm jobs={state.jobs} scenarios={scenarios} macros={macros} ownJob={own} />
            <div className="card">
              <h2>Вкладки</h2>
              <div className="workers">
                {tabs.length === 0 && <div className="empty">Нет активных вкладок.<br /><b>После запуска карточки появятся здесь.</b></div>}
                {tabs.map(t => <TabCard key={t.worker.id} job={t.job} worker={t.worker} scenarios={scenarios} macros={macros} onScenariosChanged={() => { refreshScenarios(); refreshMacros(); }} />)}
              </div>
              <div className="totals">
                <div className="tile"><div className="t-lbl">Активных вкладок</div><div className="t-val g">{tabs.length}</div></div>
                <div className="tile"><div className="t-lbl">Триггеров</div><div className="t-val g">{(state.triggers || []).length}</div></div>
                <div className="tile"><div className="t-lbl">Ошибок</div><div className="t-val a">{errors}</div></div>
              </div>
              <div className="system-panel">
                <div className="system-head"><h3>Нагрузка</h3><strong>{state.system.cpu_percent}%</strong></div>
                <svg className="system-chart" viewBox="0 0 600 112" preserveAspectRatio="none" aria-label="График загрузки CPU">
                  <path className="grid-line" d="M0 28 H600 M0 56 H600 M0 84 H600" />
                  <path className="cpu-area" d={line ? line + ` L${((cpu.current.length - 1) / 59 * 600).toFixed(1)},112 L0,112 Z` : ''} /><path className="cpu-line" d={line} />
                </svg>
                <div className="system-foot"><span>RAM <b>{state.system.memory_percent}%</b></span><span>Процессов Chrome <b>{state.system.chromium_processes}</b></span><span>Обновление каждые 2 с</span></div>
              </div>
            </div>
          </div>
          <div className="log">{state.log.slice(-60).map((l, i) => <div className="l" key={i}>{l}</div>)}</div>
          <Automation jobs={state.jobs} triggers={state.triggers || []} macros={macros} onMacrosChanged={refreshMacros} />
        </>
      )}
      <footer>Katya <b>Browser Lab</b> · React · <a href="/legacy/" style={{ color: 'inherit' }}>старая панель</a></footer>
      <Toast />
    </div>
  );
}
