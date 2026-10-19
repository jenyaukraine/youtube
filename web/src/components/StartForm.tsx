import { useEffect, useState } from 'react';
import { startTabs, stopJob, toast } from '../lib/api';
import type { Job, Macro, Scenario, Step } from '../lib/types';

interface Props { jobs: Job[]; scenarios: Scenario[]; macros: Macro[]; ownJob?: Job; onChrome: () => void }

/** Форма «Открыть вкладки»: адрес, потоки, длительность, профиль, сценарий при открытии, заголовки. */
export function StartForm({ jobs, scenarios, macros, ownJob, onChrome }: Props) {
  const [url, setUrl] = useState(() => localStorage.getItem('katya_last_url') || 'https://');
  const [workers, setWorkers] = useState(1);
  const [duration, setDuration] = useState(0);
  const [uaMode, setUaMode] = useState('chrome');
  const [scenario, setScenario] = useState('');
  const [headers, setHeaders] = useState('');
  const [busy, setBusy] = useState(false);

  const source = (): { steps: Step[]; startUrl?: string; settings?: Scenario['settings'] } | null => {
    if (!scenario) return null;
    if (scenario.startsWith('scenario:')) return scenarios.find(s => s.id === scenario.slice(9)) || null;
    const m = macros.find(m => m.name === scenario.slice(6)); return m ? { steps: m.steps, startUrl: m.start_url, settings: m.settings } : null;
  };
  useEffect(() => { // настройки запуска берутся из сценария
    const src = source(); if (!src) return;
    const applied: string[] = [];
    if (src.settings?.headers && Object.keys(src.settings.headers).length) { setHeaders(JSON.stringify(src.settings.headers, null, 1)); applied.push('заголовки'); }
    if (src.settings?.user_agent_mode) { setUaMode(src.settings.user_agent_mode); applied.push('профиль браузера'); }
    if (src.startUrl && /^https?:/.test(src.startUrl)) { setUrl(src.startUrl); applied.push('адрес'); }
    if (applied.length) toast('Из сценария: ' + applied.join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario]);

  const start = async () => {
    const u = url.trim(); if (!/^https?:\/\/[^\s/]+/i.test(u)) { toast('Вставь полный адрес страницы', 'err'); return; }
    let h: Record<string, string> = {};
    try { h = JSON.parse(headers.trim() || '{}'); if (!h || Array.isArray(h) || typeof h !== 'object') throw new Error(); } catch { toast('Заголовки должны быть JSON-объектом', 'err'); return; }
    setBusy(true);
    const src = source();
    const steps = (src?.steps || []).map(({ action, kind, query, role, value, replace, x, y, end_x, end_y, nth, timeout_ms, optional, name, scroll_state }) => ({ action, kind, query, role, value, replace, x, y, end_x, end_y, nth, timeout_ms, optional, name, scroll_state }));
    const r = await startTabs({ url: u, workers, duration, headers: h, user_agent_mode: uaMode, steps });
    setBusy(false);
    if (!r.ok) { toast(r.error || 'Ошибка запуска', 'err'); return; }
    localStorage.setItem('katya_last_url', u);
    toast(`Открыто вкладок: ${r.workers}`);
  };

  return (
    <div className="card">
      <h2>Открыть вкладки</h2>
      <label>Адрес страницы</label>
      <input type="url" value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && start()} placeholder="https://example.com" spellCheck={false} autoComplete="url" />
      <div className="hint">Любой полный http:// или https:// URL.</div>

      <label>Способ запуска</label>
      <div className="method-switch" role="group" aria-label="Способ запуска">
        <button type="button" className="active" aria-pressed="true"><span>◈</span><b>Playwright</b><small>На сервере · выбран</small></button>
        <button type="button" aria-pressed="false" onClick={onChrome}><span>◎</span><b>Мой Chrome</b><small>Через расширение</small></button>
      </div>

      <label>Потоков (параллельных окон)</label>
      <div className="slider-row"><input type="range" min={1} max={8} value={workers} onChange={e => setWorkers(Number(e.target.value))} /><div className="slider-val">{workers}</div></div>

      <label>Длительность сессии</label>
      <div className="seg">{[[0, 'Без лимита'], [1800, '30 мин'], [3600, '1 час']].map(([v, t]) => <button key={v} type="button" className={duration === v ? 'on' : ''} onClick={() => setDuration(v as number)}>{t}</button>)}</div>

      <label htmlFor="uaMode">Профиль браузера для каждой вкладки</label>
      <select id="uaMode" value={uaMode} onChange={e => setUaMode(e.target.value)}>
        <option value="chrome">Родной профиль браузера</option><option value="random">Случайный Chrome или Edge</option><option value="browser">Браузер без профиля</option>
      </select>

      <label htmlFor="startScenario">Сценарий при открытии</label>
      <select id="startScenario" value={scenario} onChange={e => setScenario(e.target.value)}>
        <option value="">Нет, просто открыть страницу</option>
        {scenarios.filter(s => s.steps?.length).map(s => <option key={s.id} value={`scenario:${s.id}`}>{s.name} ({s.steps.length} шагов)</option>)}
        {macros.filter(m => !scenarios.some(s => s.name === m.name)).map(m => <option key={m.name} value={`macro:${m.name}`}>{m.name} (сервер)</option>)}
      </select>
      <div className="hint">Вкладка откроет адрес и через 1 секунду выполнит сохранённые шаги.</div>

      <details className="advanced"><summary>HTTP-заголовки для новых вкладок</summary>
        <textarea value={headers} onChange={e => setHeaders(e.target.value)} spellCheck={false} placeholder='{"Accept-Language":"ru-RU,ru;q=0.9"}' />
        <div className="hint">JSON. Применяются ко всем запросам вкладки. Cookie и Authorization сюда не вводи.</div>
      </details>

      <div className="btn-row">
        <button className="btn btn-go" disabled={busy} onClick={start}>Запустить</button>
        <button className="btn btn-stop" disabled={!ownJob} onClick={() => ownJob && stopJob(ownJob.id)}>Стоп</button>
      </div>
      {jobs.length > 0 && <div className="hint" style={{ marginTop: 10 }}>Открыто вкладок: {jobs.filter(j => j.status === 'running').reduce((n, j) => n + j.workers_list.filter(w => w.state !== 'stopped').length, 0)}</div>}
    </div>
  );
}
