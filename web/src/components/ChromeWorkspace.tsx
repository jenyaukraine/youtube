import { useCallback, useEffect, useRef, useState } from 'react';
import { chromeBridge, recordedEventsToSteps, type ChromeTab } from '../lib/chromeBridge';
import { updateInstalledExtension, restoreExtensionDirectory } from '../lib/extensionUpdater';
import { runScenario, scenarioPause } from '../lib/scenarioRunner';
import { localScenarios, newScenarioName, saveLocalScenarios, saveMacro, toast } from '../lib/api';
import type { Macro, Scenario, ScenarioStatus, Step } from '../lib/types';
import { ScenarioPanel, type ClientRun } from './ScenarioPanel';
import { ScenariosPage } from '../pages/ScenariosPage';

interface Props { scenarios: Scenario[]; macros: Macro[]; onBack: () => void; onScenariosChanged: () => void }
interface Video { paused: boolean; currentTime: number; duration: number; readyState: number }
const DEFAULT_URL = 'https://www.youtube.com/watch?v=i6XB07FpBG0';
const VERSION = '0.6.0';

export function ChromeWorkspace({ scenarios, macros, onBack, onScenariosChanged }: Props) {
  const [url, setUrl] = useState(() => localStorage.getItem('katya_last_url') || DEFAULT_URL);
  const [choice, setChoice] = useState('');
  const [tab, setTab] = useState<ChromeTab | null>(null);
  const [version, setVersion] = useState('');
  const [connected, setConnected] = useState(false);
  const [tabs, setTabs] = useState<ChromeTab[]>([]);
  const [frame, setFrame] = useState('');
  const [video, setVideo] = useState<Video | null>(null);
  const [visibility, setVisibility] = useState('');
  const [steps, setSteps] = useState<Step[]>([]);
  const [recording, setRecording] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [repeat, setRepeat] = useState(1);
  const [from, setFrom] = useState(0);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [chipPicked, setChipPicked] = useState<number | null>(null);
  const [run, setRun] = useState<ClientRun | null>(null);
  const [phase, setPhase] = useState<ScenarioStatus>({});
  const [message, setMessage] = useState('');
  const [waitLeft, setWaitLeft] = useState(0);
  const [updating, setUpdating] = useState(false);
  const [updateMessage, setUpdateMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const cancelled = useRef(false);
  const shotBusy = useRef(false);
  const inputQueue = useRef(Promise.resolve());
  const dragging = useRef(false);
  const lastMove = useRef(0);
  const lastActivity = useRef(0);
  const recordingRef = useRef(recording);
  const tabRef = useRef(tab);
  const startUrl = useRef(url);
  recordingRef.current = recording;
  tabRef.current = tab;

  const refreshStatus = useCallback(async () => {
    const result = await chromeBridge('status');
    setConnected(result.ok);
    setVersion(result.version || '');
    setTab(result.version === VERSION ? result.tab || null : null);
    setRecording(!!result.recording);
  }, []);
  useEffect(() => {
    restoreExtensionDirectory(); refreshStatus();
    const timer = window.setInterval(refreshStatus, 4000);
    return () => window.clearInterval(timer);
  }, [refreshStatus]);

  const shot = useCallback(async () => {
    if (!tabRef.current || document.hidden || shotBusy.current) return;
    shotBusy.current = true;
    try {
      const result = await chromeBridge('screenshot');
      if (result.ok && result.image) setFrame(result.image);
      else setMessage(result.error || 'Кадр недоступен');
    } finally { shotBusy.current = false; }
  }, []);
  useEffect(() => {
    if (!tab) { setFrame(''); setVideo(null); return; }
    shot();
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      shot();
      chromeBridge('media').then(result => {
        setVideo(result.media?.video || null);
        setVisibility(result.media?.visibility || '');
      });
    }, recording || replaying || Date.now() - lastActivity.current < 5000 ? 350 : 1200);
    return () => window.clearInterval(timer);
  }, [tab?.id, recording, replaying, shot]);

  const source = () => {
    if (choice.startsWith('scenario:')) return scenarios.find(s => s.id === choice.slice(9)) || null;
    if (choice.startsWith('macro:')) return macros.find(m => m.name === choice.slice(6)) || null;
    return null;
  };
  const substitute = (step: Step, variables: Record<string, string>): Step => {
    const replace = (text: string | undefined) => String(text || '').replace(/{{\s*([\w]+)\s*}}/g, (_, name) => {
      if (name === 'password') throw new Error('Пароль вводится вручную во вкладке Chrome.');
      if (!(name in variables)) throw new Error(`Заполни переменную ${name} в сценарии.`);
      return String(variables[name]);
    });
    return { ...step, query: replace(step.query), value: replace(step.value) };
  };
  const play = async (list: Step[], start = 0, pageOpened = false, targetUrl = url) => {
    if (!list.length) return;
    cancelled.current = false; setReplaying(true); setPhase({ phase: 'running', current: start, completed: start });
    const selected = source();
    const variables = selected && 'variables' in selected ? selected.variables || {} : {};
    try {
      const result = await runScenario({ steps: list, from: start, repeats: repeat, cancelled: () => cancelled.current,
        beforeRepeat: async pass => {
          if (pass) {
            const next = await chromeBridge('execute', { step: { action: 'navigate', value: targetUrl } });
            if (!next.ok) throw new Error(next.error || 'Не удалось открыть страницу');
          }
          if (pass || pageOpened) await scenarioPause(3000, () => cancelled.current, ms => setWaitLeft(ms));
        },
        onStep: (i) => { setRun({ index: i, total: list.length }); setPhase({ phase: 'running', current: i, completed: i }); },
        onWait: ms => setWaitLeft(ms),
        execute: async raw => {
          const step = substitute(raw, variables);
          if (step.action === 'screenshot') { await shot(); return { ok: true }; }
          const response = await chromeBridge('execute', { step });
          lastActivity.current = Date.now(); shot();
          return response;
        },
      });
      if (result.ok) { setPhase({ phase: 'done', current: list.length - 1, completed: list.length }); setMessage(`Готово · ${repeat} повторов`); }
      else if (result.stopped) { setPhase({}); setMessage('Остановлено'); }
      else { setPhase({ phase: 'error', current: result.index || 0, completed: result.index || 0 }); setMessage(`Шаг ${(result.index || 0) + 1}: ${result.error}`); toast(`Шаг ${(result.index || 0) + 1}: ${result.error}`, 'err'); }
    } catch (error) { setPhase({ phase: 'error' }); setMessage((error as Error).message); toast((error as Error).message, 'err'); }
    finally { setReplaying(false); setRun(null); setWaitLeft(0); refreshStatus(); }
  };
  const start = async () => {
    if (!/^https?:\/\/[^\s/]+/i.test(url.trim())) { toast('Укажи полный адрес страницы', 'err'); return; }
    setBusy(true);
    const selected = source();
    try {
      let opened = false;
      if (!tab || tab.url !== url.trim()) {
        const reply = await chromeBridge('open', { url: url.trim() });
        if (!reply.ok) throw new Error(reply.error || 'Не удалось открыть Chrome');
        setTab(reply.tab || null); opened = true;
      }
      localStorage.setItem('katya_last_url', url.trim());
      startUrl.current = url.trim();
      if (selected?.steps?.length) { const list = structuredClone(selected.steps); setSteps(list); await play(list, 0, opened, url.trim()); }
      else { setMessage('Вкладка подключена · можно записывать действия'); await refreshStatus(); }
      shot();
    } catch (error) { toast((error as Error).message, 'err'); }
    finally { setBusy(false); }
  };
  const toggleRecord = async () => {
    const next = !recording;
    const reply = await chromeBridge('record', { enabled: next });
    if (!reply.ok) { toast(reply.error || 'Не удалось включить запись', 'err'); return; }
    setRecording(next);
    if (next) { setSteps([]); setPhase({}); startUrl.current = tab?.url || url; setMessage('Запись идёт'); }
    else {
      const events = await chromeBridge('events');
      if (events.ok && Array.isArray(events.events)) {
        const list = recordedEventsToSteps(events.events);
        setSteps(list); setMessage(`Записано ${list.length} шагов · паузы учтены`);
      }
    }
  };
  const save = async () => {
    if (!steps.length) { toast('Сначала запиши действия', 'err'); return; }
    const target = startUrl.current || url;
    const name = newScenarioName(target, steps.length);
    const scenario: Scenario = { id: crypto.randomUUID(), name, startUrl: target, steps, createdAt: new Date().toISOString() };
    saveLocalScenarios([scenario, ...localScenarios()]); onScenariosChanged();
    const result = await saveMacro({ name, steps, start_url: target, description: target });
    toast(result.ok ? `Сохранено: ${name}` : `Локально сохранено; сервер: ${result.error || 'ошибка'}`, result.ok ? 'ok' : 'err');
  };
  const execute = async (step: Step) => {
    const result = await chromeBridge('execute', { step });
    if (!result.ok) toast(result.error || 'Действие не выполнено', 'err');
    lastActivity.current = Date.now(); shot();
  };
  const point = (event: { clientX: number; clientY: number }) => {
    const image = imgRef.current; if (!image) return { x: 0, y: 0 };
    const rect = image.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  };
  const input = (payload: Record<string, unknown>) => {
    inputQueue.current = inputQueue.current.then(async () => {
      const result = await chromeBridge('input', payload);
      if (!result.ok) throw new Error(result.error || 'Нет ответа от вкладки');
      lastActivity.current = Date.now(); shot();
    }).catch(error => toast(error.message, 'err'));
  };
  const videoAction = async (type: string, time?: number) => {
    const result = await chromeBridge('media-action', { type, time });
    if (!result.ok) toast(result.error || 'Видео не ответило', 'err');
    const state = await chromeBridge('media'); setVideo(state.media?.video || null); shot();
  };
  const updateExtension = async () => {
    setUpdating(true);
    try {
      const result = await updateInstalledExtension();
      setUpdateMessage(result.reloaded ? `Версия ${result.version} установлена.` : `Файлы ${result.version} установлены. Один раз нажмите «Обновить» в chrome://extensions.`);
      setTimeout(refreshStatus, 1800);
    } catch (error) { if ((error as Error).name !== 'AbortError') setUpdateMessage((error as Error).message); }
    finally { setUpdating(false); }
  };
  const patchSteps = (list: Step[]) => { setSteps(list); setPhase({}); };
  const time = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;

  return <div className="grid chrome-react-grid">
    <div className="card chrome-control-card">
      <h2>Открыть вкладку</h2>
      <label>Адрес страницы</label>
      <input type="url" value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && start()} spellCheck={false} />
      <label>Способ запуска</label>
      <div className="method-switch" role="group" aria-label="Способ запуска">
        <button type="button" onClick={onBack}><span>◈</span><b>Playwright</b><small>На сервере</small></button>
        <button type="button" className="active" aria-pressed="true"><span>◎</span><b>Мой Chrome</b><small>Через расширение</small></button>
      </div>
      <div className="chrome-connection"><strong className={connected && version === VERSION ? 'connected' : 'error'}>{!connected ? 'Расширение не найдено' : version !== VERSION ? `Нужно обновить до ${VERSION}` : 'Chrome подключён'}</strong><small>{tab ? `${tab.title} · ${tab.url}` : 'Подключённой вкладки пока нет'}</small></div>
      <details className="chrome-existing" onToggle={e => { if (e.currentTarget.open) chromeBridge('tabs').then(r => setTabs(r.tabs || [])); }}><summary>Подключить открытую вкладку</summary><div className="chrome-tab-list">{tabs.map(item => <button type="button" key={item.id} onClick={async () => { const r = await chromeBridge('attach', { tabId: item.id }); if (r.ok) refreshStatus(); else toast(r.error || 'Не удалось подключить', 'err'); }}><b>{item.title}</b><small>{item.url}</small></button>)}</div></details>
      <details className="chrome-install" open={connected && version !== VERSION}><summary>Установка и обновление расширения</summary><button type="button" className="chrome-update-button" disabled={updating} onClick={updateExtension}>{updating ? 'Обновляю…' : 'Обновить расширение'}</button><div className="hint" aria-live="polite">{updateMessage || 'При первом обновлении выберите папку установленного расширения. Затем достаточно кнопки.'}</div><p><a href="/Katya-Browser-Bridge.zip" download>Скачать ZIP для первой установки ↗</a></p></details>
      <label htmlFor="chrome-start-scenario">Сценарий при открытии</label>
      <select id="chrome-start-scenario" value={choice} onChange={e => { setChoice(e.target.value); const found = e.target.value.startsWith('scenario:') ? scenarios.find(s => s.id === e.target.value.slice(9)) : macros.find(m => m.name === e.target.value.slice(6)); if (found?.steps) { setSteps(structuredClone(found.steps)); startUrl.current = 'startUrl' in found ? found.startUrl : found.start_url || url; } }}><option value="">Нет, просто открыть страницу</option>{scenarios.filter(s => s.steps.length).map(s => <option key={s.id} value={`scenario:${s.id}`}>{s.name} ({s.steps.length} шагов)</option>)}{macros.filter(m => !scenarios.some(s => s.name === m.name)).map(m => <option key={m.name} value={`macro:${m.name}`}>{m.name} (сервер)</option>)}</select>
      <div className="hint">После загрузки страницы сценарий ждёт 3 секунды. Шаги видны справа.</div>
      <div className="btn-row"><button type="button" className="btn btn-go" disabled={busy || !connected || version !== VERSION} onClick={start}>{steps.length && choice ? 'Запустить сценарий' : 'Открыть в Chrome'}</button><button type="button" className="btn btn-stop" disabled={!replaying} onClick={() => { cancelled.current = true; }}>Стоп</button></div>
    </div>
    <div className="card chrome-react-workspace">
      <h2>Вкладка Chrome</h2>
      <details className="scenarios-inline"><summary>Сохранённые сценарии · {scenarios.length + macros.length}</summary><ScenariosPage scenarios={scenarios} macros={macros} onChanged={onScenariosChanged} onMacrosChanged={onScenariosChanged} onStarted={() => undefined} /></details>
      <div className="chrome-toolbar"><span className="chrome-mode-label">{tab ? tab.title || 'Живая вкладка' : 'Нет подключённой вкладки'}</span>{tab && <button type="button" className="btn" onClick={async () => { await chromeBridge('detach'); refreshStatus(); }}>Отключить</button>}</div>
      {visibility === 'hidden' && video && !video.paused && <div className="chrome-media-state">Вкладка скрыта — плеер может ждать активации <button type="button" onClick={() => chromeBridge('promote').then(refreshStatus)}>Открыть отдельно</button></div>}
      <div className={'chrome-shot' + (frame ? '' : ' empty')} id="chromeShotFrame" ref={frameRef} tabIndex={0}
        onPointerDown={e => { if (!frame || e.button !== 0) return; e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); dragging.current = true; input({ type: 'down', ...point(e) }); }}
        onPointerMove={e => { if (!frame || Date.now() - lastMove.current < (dragging.current ? 24 : 60)) return; lastMove.current = Date.now(); input({ type: 'move', dragging: dragging.current, ...point(e) }); }}
        onPointerUp={e => { if (!dragging.current) return; dragging.current = false; input({ type: 'up', ...point(e) }); }}
        onWheel={e => { if (frame) { e.preventDefault(); input({ type: 'wheel', ...point(e), deltaX: e.deltaX, deltaY: e.deltaY }); } }}
        onKeyDown={e => { if (!frame) return; e.preventDefault(); const modifiers = (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0); input(e.key.length === 1 && !modifiers ? { type: 'text', text: e.key } : { type: 'key', key: e.key, code: e.code, modifiers }); }}
        onPaste={e => { e.preventDefault(); input({ type: 'text', text: e.clipboardData.getData('text/plain') }); }}>
        {frame ? <img ref={imgRef} src={frame} alt="Живая вкладка Chrome" draggable={false} /> : <span id="chromeShotEmpty">{message || 'Откройте или подключите вкладку Chrome'}</span>}
      </div>
      {video && <div className="chrome-video-controls"><button type="button" onClick={() => videoAction(video.paused ? 'play' : 'pause')}>{video.paused ? '▶' : 'Ⅱ'}</button><button type="button" onClick={() => videoAction('seek', Math.max(0, video.currentTime - 10))}>−10</button><input type="range" min={0} max={Math.max(1, Math.floor(video.duration || 1))} value={Math.floor(video.currentTime || 0)} onChange={e => videoAction('seek', Number(e.target.value))} aria-label="Перемотка видео" /><button type="button" onClick={() => videoAction('seek', video.currentTime + 10)}>+10</button><span>{time(video.currentTime)} / {time(video.duration)}</span></div>}
      <div className="record-status" aria-live="polite">{waitLeft ? `Пауза · осталось ${(waitLeft / 1000).toFixed(1)} с` : message}</div>
      <ScenarioPanel scenarioSteps={steps} status={phase} clientRun={run} chipPicked={chipPicked} onChipPick={i => { setChipPicked(i); setFrom(i); }} onRunFrom={() => play(steps, chipPicked ?? 0)} onClearPick={() => { setChipPicked(null); setFrom(0); }}
        steps={steps} from={from} picked={picked} recording={recording} replaying={replaying} repeat={repeat} setRepeat={setRepeat} statusText={recording ? '● Запись идёт · действия и паузы сохраняются' : `${steps.length} шагов`}
        onToggleRecord={toggleRecord} onReplay={() => replaying ? (cancelled.current = true) : play(steps, from)} onSave={save}
        onLoad={value => { const found = value.startsWith('scenario:') ? scenarios.find(s => s.id === value.slice(9)) : macros.find(m => m.name === value.slice(6)); if (found?.steps) { patchSteps(structuredClone(found.steps)); setChoice(value); } }}
        loadOptions={[...scenarios.map(s => ({ label: s.name, value: `scenario:${s.id}` })), ...macros.map(m => ({ label: `${m.name} · сервер`, value: `macro:${m.name}` }))]}
        onPickStart={i => setFrom(i)} onToggle={(i, shift) => setPicked(old => { const next = new Set(old); if (shift) { for (let n = Math.min(from, i); n <= Math.max(from, i); n++) next.add(n); } else if (next.has(i)) next.delete(i); else next.add(i); return next; })} onDelete={() => { patchSteps(steps.filter((_, i) => !picked.has(i))); setPicked(new Set()); }} onUnpick={() => { setPicked(new Set()); setFrom(0); }}
        onPatchStep={(i, step) => patchSteps(steps.map((old, n) => n === i ? step : old))} onRemoveStep={i => patchSteps(steps.filter((_, n) => n !== i))}
        onCopy={() => navigator.clipboard.writeText(JSON.stringify(steps, null, 2)).then(() => toast('Шаги скопированы'))} onClear={() => patchSteps([])} onManual={execute} />
    </div>
  </div>;
}
