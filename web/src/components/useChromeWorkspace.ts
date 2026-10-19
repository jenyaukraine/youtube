import { useCallback, useEffect, useRef, useState } from 'react';
import { chromeBridge, recordedEventsToSteps, type ChromeTab } from '../lib/chromeBridge';
import { restoreExtensionDirectory, updateInstalledExtension } from '../lib/extensionUpdater';
import { runScenario, scenarioPause } from '../lib/scenarioRunner';
import { localScenarios, newScenarioName, saveLocalScenarios, saveMacro, toast } from '../lib/api';
import type { Macro, Scenario, ScenarioStatus, Step } from '../lib/types';
import type { ClientRun } from './ScenarioPanel';

export interface VideoState { paused: boolean; currentTime: number; duration: number; readyState: number }
export const EXTENSION_VERSION = '0.6.1';
const DEFAULT_URL = 'https://www.youtube.com/watch?v=i6XB07FpBG0';

interface Options { scenarios: Scenario[]; macros: Macro[]; onScenariosChanged: () => void }

/** Browser connection, recorder and scenario execution for the Chrome workspace. */
export function useChromeWorkspace({ scenarios, macros, onScenariosChanged }: Options) {
  const [url, setUrl] = useState(() => localStorage.getItem('katya_last_url') || DEFAULT_URL);
  const [choice, setChoice] = useState('');
  const [tab, setTab] = useState<ChromeTab | null>(null);
  const [version, setVersion] = useState('');
  const [connected, setConnected] = useState(false);
  const [tabs, setTabs] = useState<ChromeTab[]>([]);
  const [frame, setFrame] = useState('');
  const [video, setVideo] = useState<VideoState | null>(null);
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
  const cancelled = useRef(false);
  const shotBusy = useRef(false);
  const lastFocusAttempt = useRef(0);
  const lastActivity = useRef(0);
  const tabRef = useRef(tab);
  const startUrl = useRef(url);
  tabRef.current = tab;

  const refreshStatus = useCallback(async () => {
    const result = await chromeBridge('status');
    setConnected(result.ok);
    setVersion(result.version || '');
    setTab(result.version === EXTENSION_VERSION ? result.tab || null : null);
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
        const visibility = result.media?.visibility || '';
        setVisibility(visibility);
        if (visibility === 'hidden' && Date.now() - lastFocusAttempt.current > 10000) {
          lastFocusAttempt.current = Date.now();
          chromeBridge('keep-visible').then(reply => {
            if (!reply.ok) setMessage(reply.error || 'Не удалось сохранить активность вкладки');
          });
        }
      });
    }, recording || replaying || Date.now() - lastActivity.current < 5000 ? 350 : 1200);
    return () => window.clearInterval(timer);
  }, [tab?.id, recording, replaying, shot]);

  const source = (value = choice) => {
    if (value.startsWith('scenario:')) return scenarios.find(s => s.id === value.slice(9)) || null;
    if (value.startsWith('macro:')) return macros.find(m => m.name === value.slice(6)) || null;
    return null;
  };
  const selectScenario = (value: string) => {
    setChoice(value);
    const found = source(value);
    if (found?.steps) {
      setSteps(structuredClone(found.steps));
      startUrl.current = 'startUrl' in found ? found.startUrl : found.start_url || url;
    }
  };
  const loadScenario = (value: string) => {
    const found = source(value);
    if (found?.steps) { patchSteps(structuredClone(found.steps)); setChoice(value); }
  };
  const substitute = (step: Step, variables: Record<string, string>): Step => {
    const replace = (value: string | undefined) => String(value || '').replace(/{{\s*([\w]+)\s*}}/g, (_, name) => {
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
        onStep: i => { setRun({ index: i, total: list.length }); setPhase({ phase: 'running', current: i, completed: i }); },
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
  const refreshTabs = async () => { const result = await chromeBridge('tabs'); setTabs(result.tabs || []); };
  const attach = async (tabId: number) => {
    const result = await chromeBridge('attach', { tabId });
    if (result.ok) refreshStatus(); else toast(result.error || 'Не удалось подключить', 'err');
  };
  const detach = async () => { await chromeBridge('detach'); refreshStatus(); };
  const patchSteps = (list: Step[]) => { setSteps(list); setPhase({}); };
  const togglePick = (index: number, shift: boolean) => setPicked(old => {
    const next = new Set(old);
    if (shift) for (let n = Math.min(from, index); n <= Math.max(from, index); n++) next.add(n);
    else if (next.has(index)) next.delete(index); else next.add(index);
    return next;
  });
  const deletePicked = () => { patchSteps(steps.filter((_, index) => !picked.has(index))); setPicked(new Set()); };
  const clearPick = () => { setChipPicked(null); setFrom(0); };
  const stop = () => { cancelled.current = true; };

  return {
    url, setUrl, choice, tab, tabs, version, connected, frame, video, visibility, steps, recording, replaying,
    repeat, setRepeat, from, setFrom, picked, setPicked, chipPicked, setChipPicked, run, phase, message, waitLeft,
    updating, updateMessage, busy, start, play, stop, toggleRecord, save, execute, videoAction, updateExtension,
    refreshTabs, attach, detach, selectScenario, loadScenario, patchSteps, togglePick, deletePicked, clearPick,
    shot, lastActivity,
  };
}
