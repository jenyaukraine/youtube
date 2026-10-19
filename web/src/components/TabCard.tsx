import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DRAFT_STORE, controlToken, describeStep, listMacros, localScenarios, newScenarioName, reloadWorker, rememberedSteps,
  runAction, saveLocalScenarios, saveMacro, screenshotUrl, stopWorker, toast,
} from '../lib/api';
import type { Job, Macro, Scenario, Step, Worker } from '../lib/types';
import { ScenarioPanel, type ClientRun, type LoadOption } from './ScenarioPanel';

interface Props { job: Job; worker: Worker; scenarios: Scenario[]; macros: Macro[]; onScenariosChanged: () => void }

interface Draft { key: string; startUrl: string; steps: Step[]; updatedAt: number }
function drafts(): Draft[] { try { const d = JSON.parse(localStorage.getItem(DRAFT_STORE) || '[]'); return Array.isArray(d) ? d : []; } catch { return []; } }
function saveDrafts(list: Draft[]) { try { localStorage.setItem(DRAFT_STORE, JSON.stringify(list.slice(0, 30))); } catch { /* ignore */ } }

/** Карточка вкладки: живой кадр с управлением, строка состояния, адрес, панель сценария. */
export function TabCard({ job, worker, scenarios, macros, onScenariosChanged }: Props) {
  const owned = !!controlToken(job.id);
  const cardRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(true);
  const previewRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const keyRef = useRef<HTMLTextAreaElement>(null);
  const [frame, setFrame] = useState('');
  const [frameAt, setFrameAt] = useState('');
  const touchedAt = useRef(0);
  const recordingRef = useRef(false);
  const requestFrame = useRef<() => void>(() => {});
  const [hit, setHit] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // ---- живой кадр: один запрос за раз, быстрый отклик после действия
  useEffect(() => {
    let busy = false, stop = false, visible = false, urgent = false;
    let timer: number | undefined;
    const schedule = (delay: number) => { window.clearTimeout(timer); if (!stop) timer = window.setTimeout(tick, delay); };
    const tick = async () => {
      if (stop) return;
      if (document.hidden || !visible) { schedule(800); return; }
      if (busy) { urgent = true; return; }
      busy = true;
      const url = screenshotUrl(job.id, worker.id, true);
      await new Promise<void>(resolve => {
        const i = new Image();
        i.onload = () => { if (!stop) { setFrame(url); setFrameAt(new Date().toLocaleTimeString('ru-RU')); } resolve(); };
        i.onerror = () => resolve();
        i.src = url;
      });
      busy = false;
      const active = recordingRef.current || Date.now() - touchedAt.current < 5000;
      schedule(urgent ? 180 : collapsed ? 8000 : active ? 280 : 1200);
      urgent = false;
    };
    requestFrame.current = () => {
      touchedAt.current = Date.now();
      if (busy) urgent = true;
      else schedule(0);
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) schedule(0); }, { rootMargin: '150px' });
    if (cardRef.current) observer.observe(cardRef.current);
    const onVisibility = () => { if (!document.hidden && visible) schedule(0); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop = true; window.clearTimeout(timer); observer.disconnect(); document.removeEventListener('visibilitychange', onVisibility); requestFrame.current = () => {}; };
  }, [job.id, worker.id, collapsed]);

  useEffect(() => {
    const onHit = (e: Event) => { const d = (e as CustomEvent).detail; if (d.job === job.id && d.worker === worker.id) { setHit(d.box); window.setTimeout(() => setHit(null), 4000); } };
    window.addEventListener('katya-hit', onHit); return () => window.removeEventListener('katya-hit', onHit);
  }, [job.id, worker.id]);

  // ---- рекордер
  const [steps, setSteps] = useState<Step[]>([]);
  const [recording, setRecording] = useState(false);
  const [from, setFrom] = useState(0);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [repeat, setRepeat] = useState(1);
  const [replaying, setReplaying] = useState(false);
  recordingRef.current = recording || replaying || worker.scenario?.phase === 'running';
  const [clientRun, setClientRun] = useState<ClientRun | null>(null);
  const [chipPicked, setChipPicked] = useState<number | null>(null);
  const cancelRef = useRef(false);
  const lastActRef = useRef(0);
  const lastPickRef = useRef<number | null>(null);
  const startUrlRef = useRef('');

  useEffect(() => { // восстановить черновик этой вкладки
    const d = drafts().find(x => x.key === worker.id);
    if (d?.steps?.length) { setSteps(d.steps); startUrlRef.current = d.startUrl; }
  }, [worker.id]);
  const persist = useCallback((list: Step[]) => {
    const rest = drafts().filter(x => x.key !== worker.id);
    saveDrafts(list.length ? [{ key: worker.id, startUrl: startUrlRef.current || worker.url, steps: list.slice(0, 200), updatedAt: Date.now() }, ...rest] : rest);
  }, [worker.id, worker.url]);
  const updateSteps = (list: Step[]) => { setSteps(list); persist(list); };

  const act = useCallback(async (step: Step, opts: { record?: boolean; quiet?: boolean } = {}) => {
    if (!owned) { toast('Эта вкладка открыта не из этой панели: действия недоступны', 'err'); return null; }
    touchedAt.current = Date.now();
    const r = await runAction(job.id, worker.id, step);
    requestFrame.current();
    if (!opts.quiet) toast(r.ok ? 'Действие выполнено' : (r.error || 'Действие не выполнено'), r.ok ? 'ok' : 'err');
    if (r.ok && recording && opts.record !== false && step.action !== 'inspect' && step.action !== 'move') {
      setSteps(prev => {
        const next = [...prev];
        const now = Date.now();
        if (lastActRef.current && now - lastActRef.current >= 350 && next.length) next.push({ action: 'wait', value: String(Math.min(60000, Math.round((now - lastActRef.current) / 100) * 100)) });
        lastActRef.current = now;
        const last = next[next.length - 1];
        if (step.action === 'type' && last?.action === 'type') last.value = (last.value || '') + (step.value || '');
        else next.push(step.action === 'point' ? { ...step, query: r.selector || step.query, scroll_state: r.scroll_state || step.scroll_state } : step);
        persist(next); return next;
      });
    }
    return r;
  }, [owned, job.id, worker.id, recording, persist]);

  // ---- управление кадром
  const point = (e: { clientX: number; clientY: number }) => {
    const img = imgRef.current; if (!img || img.hidden) return null;
    const r = img.getBoundingClientRect(); const scale = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
    const x = (e.clientX - r.left - (r.width - w) / 2) / w, y = (e.clientY - r.top - (r.height - h) / 2) / h;
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
  };
  const dragStart = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const wheelAcc = useRef(0); const wheelTimer = useRef<number>();
  const moveTimer = useRef<number>(); const movePending = useRef<{ x: number; y: number } | null>(null);
  const textBuf = useRef(''); const textTimer = useRef<number>();
  const flushText = () => { const v = textBuf.current; textBuf.current = ''; if (v) actRef.current({ action: 'type', value: v }, { quiet: true }); };

  const onPointerDown = (e: React.PointerEvent) => { const p = point(e); if (p) dragStart.current = { ...p, cx: e.clientX, cy: e.clientY }; previewRef.current?.focus(); };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = dragStart.current; dragStart.current = null; const p = point(e); if (!p) return;
    if (s && Math.hypot(e.clientX - s.cx, e.clientY - s.cy) >= 8) act({ action: 'mouse_drag', x: s.x, y: s.y, end_x: p.x, end_y: p.y }, { quiet: true });
    else act({ action: 'point', ...p }, { quiet: true });
  };
  const actRef = useRef(act); actRef.current = act;
  useEffect(() => {
    const el = previewRef.current; if (!el) return;
    const handler = (e: WheelEvent) => {
      const p = point(e); if (!p) return; e.preventDefault();
      wheelAcc.current += e.deltaY; window.clearTimeout(wheelTimer.current);
      wheelTimer.current = window.setTimeout(() => { const d = Math.max(-3000, Math.min(3000, Math.round(wheelAcc.current))); wheelAcc.current = 0; if (d) actRef.current({ action: 'scroll', value: String(d), ...p }, { quiet: true }); }, 120);
    };
    el.addEventListener('wheel', handler, { passive: false }); return () => el.removeEventListener('wheel', handler);
  }, []);
  const onWheel = undefined;
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.buttons) return; const p = point(e); if (!p) return; movePending.current = p;
    if (moveTimer.current) return;
    moveTimer.current = window.setTimeout(() => { moveTimer.current = undefined; const m = movePending.current; movePending.current = null; if (m) act({ action: 'move', ...m }, { quiet: true, record: false }); }, 150);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const special = new Set(['Backspace', 'Delete', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Escape']);
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); textBuf.current += e.key; window.clearTimeout(textTimer.current); textTimer.current = window.setTimeout(flushText, 150); return; }
    if (special.has(e.key)) { e.preventDefault(); flushText(); act({ action: 'press', value: e.key }, { quiet: true }); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); flushText(); act({ action: 'press', value: 'ControlOrMeta+A' }, { quiet: true }); }
  };
  const onPaste = (e: React.ClipboardEvent) => { const t = e.clipboardData.getData('text/plain'); if (t) { e.preventDefault(); act({ action: 'type', value: t.slice(0, 2048) }, { quiet: true }); } };

  // ---- запись / повтор / сохранение
  const toggleRecord = () => {
    requestFrame.current();
    setRecording(r => {
      if (!r) { lastActRef.current = Date.now(); if (!steps.length) startUrlRef.current = worker.url; }
      return !r;
    });
  };
  const replay = async () => {
    if (replaying) { cancelRef.current = true; return; }
    const list = [...steps]; if (!list.length) { toast('Нет записанных шагов', 'err'); return; }
    if (list.some(s => /{{\s*[a-zA-Z][\w]*\s*}}/.test(s.value || ''))) { toast('В записи есть переменные. Задай их на странице «Сценарии»', 'err'); return; }
    setReplaying(true); cancelRef.current = false; requestFrame.current();
    let runs = 0, failed = 0;
    const showProgress = job.scenario_steps?.length === list.length;
    try {
      for (let run = 0; run < repeat && !cancelRef.current; run++) {
        for (let i = Math.min(from, list.length - 1); i < list.length; i++) {
          if (cancelRef.current) break;
          if (showProgress) setClientRun({ index: i, total: list.length });
          const r = await runAction(job.id, worker.id, list[i]);
          requestFrame.current();
          if (!r.ok) { failed = i + 1; break; }
          if (i < list.length - 1 && !list.some(s => s.action === 'wait')) await new Promise(res => setTimeout(res, 1200));
        }
        if (failed || cancelRef.current) break;
        runs++;
        if (run < repeat - 1) await new Promise(res => setTimeout(res, 500));
      }
    } finally { setReplaying(false); setClientRun(null); }
    if (failed) toast(`Сбой на повторе ${runs + 1}, шаг ${failed}`, 'err');
    else if (cancelRef.current) toast(`Остановлено: ${runs} из ${repeat}`, 'err');
    else toast(`Выполнено повторов: ${runs}`);
  };
  const save = async () => {
    if (!steps.length) { toast('Сначала запиши хотя бы одно действие', 'err'); return; }
    const startUrl = startUrlRef.current || worker.url;
    const name = newScenarioName(startUrl, steps.length);
    const settings = { user_agent_mode: 'chrome' };
    saveLocalScenarios([{ id: crypto.randomUUID(), name, startUrl, steps, settings, createdAt: new Date().toISOString() }, ...localScenarios()]);
    const r = await saveMacro({ name, steps, description: startUrl, start_url: startUrl, settings });
    saveDrafts(drafts().filter(x => x.key !== worker.id));
    onScenariosChanged();
    toast(r.ok ? `Сохранено: ${name}` : `Сохранено в этом браузере; сервер: ${r.error || 'ошибка'}`, r.ok ? 'ok' : 'err');
  };
  const load = (choice: string) => {
    let src: { steps: Step[]; startUrl?: string } | undefined;
    if (choice.startsWith('scenario:')) src = scenarios.find(s => s.id === choice.slice(9));
    else if (choice.startsWith('draft:')) src = drafts().find(d => d.key === choice.slice(6));
    else src = macros.find(m => m.name === choice.slice(6)) as { steps: Step[] } | undefined;
    if (!src?.steps?.length) { toast('Запись не найдена', 'err'); return; }
    startUrlRef.current = src.startUrl || worker.url; setFrom(0); setPicked(new Set()); updateSteps(structuredClone(src.steps));
    toast(`Загружено шагов: ${src.steps.length}. Нажми «▶ Повторить»`);
  };
  const loadOptions: LoadOption[] = useMemo(() => [
    ...scenarios.filter(s => s.steps?.length).map(s => ({ label: `Сценарий: ${s.name}`, value: `scenario:${s.id}` })),
    ...drafts().filter(d => d.steps?.length && d.key !== worker.id).map(d => ({ label: `Черновик: ${d.startUrl || d.key}`, value: `draft:${d.key}` })),
    ...macros.map(m => ({ label: `Макрос: ${m.name}`, value: `macro:${m.name}` })),
  ], [scenarios, macros, worker.id]);

  const togglePick = (i: number, shift: boolean) => setPicked(prev => {
    const next = new Set(prev);
    if (shift && lastPickRef.current != null) { const [a, b] = [Math.min(lastPickRef.current, i), Math.max(lastPickRef.current, i)]; for (let k = a; k <= b; k++) next.add(k); }
    else if (next.has(i)) next.delete(i); else next.add(i);
    lastPickRef.current = i; return next;
  });
  const deletePicked = () => { const next = steps.filter((_, i) => !picked.has(i)); if (from >= next.length) setFrom(0); setPicked(new Set()); updateSteps(next); toast(`Удалено шагов: ${picked.size}`); };

  // ---- стартовый сценарий: фишки → запись с нужного шага
  const scenarioSteps = job.scenario_steps || [];
  const fullSteps = () => { const full = rememberedSteps(job.id); const base = full?.length === scenarioSteps.length ? full : scenarioSteps; return base.map(s => ({ ...s, value: s.action === 'wait' && !s.value && s.duration_ms ? String(s.duration_ms) : (s.value || '') })); };
  const chipPick = (i: number) => { if (chipPicked === i) { setChipPicked(null); setFrom(0); return; } setChipPicked(i); setFrom(i); updateSteps(fullSteps()); };
  const runFrom = () => { if (chipPicked == null) { setFrom(0); updateSteps(fullSteps()); } setChipPicked(null); setTimeout(replay, 0); };

  // ---- адрес
  const [editUrl, setEditUrl] = useState<string | null>(null);
  const submitUrl = async () => { const v = (editUrl || '').trim(); setEditUrl(null); if (!v || v === worker.url) return; await act({ action: 'navigate', value: /^https?:\/\//i.test(v) ? v : 'https://' + v }); };

  const statusText = recording ? `● Запись идёт · ${steps.length} шагов · паузы между действиями сохраняются`
    : steps.length ? `${steps.length} шагов · черновик сохранён в этом браузере` : 'Действия на кадре и ручные действия записываются после «● Записать шаги».';

  const hitStyle = (() => {
    const img = imgRef.current, box = hit; if (!img || !box || !previewRef.current) return undefined;
    const cw = previewRef.current.clientWidth, ch = previewRef.current.clientHeight, scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale, ox = (cw - w) / 2, oy = (ch - h) / 2;
    return { left: ox + box.x * w, top: oy + box.y * h, width: Math.max(6, box.w * w), height: Math.max(6, box.h * h) };
  })();

  return (
    <div className={'worker' + (collapsed ? ' collapsed' : '')} data-id={worker.id} ref={cardRef}>
      <button type="button" className="worker-tile" aria-expanded={!collapsed} aria-label={collapsed ? 'Развернуть вкладку' : 'Свернуть вкладку'} onClick={() => { setCollapsed(v => !v); requestFrame.current(); }}>
        <span className="worker-tile-shot">{frame ? <img src={frame} alt="Миниатюра вкладки" /> : <span className="worker-tile-placeholder">Ожидаю кадр…</span>}</span>
        <span className="worker-tile-info"><strong>{(() => { try { return new URL(worker.url || job.url).hostname; } catch { return `W-${worker.id.split('-').pop()}`; } })()}</strong><small>{worker.url || job.url}</small><span className="worker-tile-state">{worker.last_action || worker.state}</span></span>
        <span className="worker-tile-chevron">⌄</span>
      </button>
      <div className="worker-preview" ref={previewRef} tabIndex={0} onWheel={onWheel} onKeyDown={onKey} onPaste={onPaste}>
        {!frame && <span className="preview-note">Ожидаю кадр…</span>}
        <img ref={imgRef} src={frame || undefined} hidden={!frame} alt="Снимок вкладки — нажми, выдели или прокрути" draggable={false}
             onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerMove={onPointerMove} />
        <textarea ref={keyRef} className="preview-key-capture" aria-label="Клавиатура вкладки" tabIndex={-1} />
        {hitStyle && <div className="preview-hit" style={hitStyle} />}
        <span className="preview-hint">{owned ? 'Клик — ввод · мышь — выделение · колесо — прокрутка · печатай с клавиатуры' : 'Вкладка открыта из другой панели: только просмотр'}</span>
        <span className="shot-time">{frame ? `● Live ${frameAt}` : 'Ожидаю кадр…'}</span>
      </div>
      <div className="worker-meta">
        <span className={'st ' + worker.state} /><span className="name">W-{worker.id.split('-').pop()}</span>
        <span className="act">{worker.last_action || worker.state}</span><span className="secs">{(worker.watch_seconds / 3600).toFixed(3)} ч</span>
      </div>
      <div className="worker-actions">
        <button type="button" onClick={async () => { const r = await reloadWorker(job.id, worker.id); requestFrame.current(); toast(r.ok ? 'Вкладка перезагружена' : (r.error || 'Ошибка'), r.ok ? 'ok' : 'err'); }}>Перезагрузить вкладку</button>
        <button type="button" className="worker-stop" onClick={async () => { await stopWorker(job.id, worker.id); }}>Закрыть</button>
      </div>
      {editUrl == null
        ? <div className="worker-url" title="Нажми, чтобы изменить адрес вкладки" onClick={() => owned && setEditUrl(worker.url)}>{worker.url || job.url}</div>
        : <input className="worker-url-edit" type="url" autoFocus value={editUrl} onChange={e => setEditUrl(e.target.value)} onBlur={() => setEditUrl(null)}
                 onKeyDown={e => { if (e.key === 'Enter') submitUrl(); if (e.key === 'Escape') setEditUrl(null); }} />}
      <ScenarioPanel
        scenarioSteps={scenarioSteps} status={worker.scenario || {}} clientRun={clientRun} chipPicked={chipPicked} onChipPick={chipPick} onRunFrom={runFrom} onClearPick={() => { setChipPicked(null); setFrom(0); }}
        steps={steps} from={from} picked={picked} recording={recording} replaying={replaying} repeat={repeat} setRepeat={setRepeat} statusText={statusText}
        onToggleRecord={toggleRecord} onReplay={replay} onSave={save} onLoad={load} loadOptions={loadOptions}
        onPickStart={i => setFrom(from === i ? 0 : i)} onToggle={togglePick} onDelete={deletePicked} onUnpick={() => { setPicked(new Set()); setFrom(0); }}
        onPatchStep={(i, step) => updateSteps(steps.map((old, n) => n === i ? step : old))} onRemoveStep={i => updateSteps(steps.filter((_, n) => n !== i))}
        onCopy={async () => { try { await navigator.clipboard.writeText(JSON.stringify(steps, null, 2)); toast('Шаги скопированы как JSON'); } catch { toast('Не удалось скопировать', 'err'); } }}
        onClear={() => { setFrom(0); setPicked(new Set()); updateSteps([]); }}
        onManual={step => act(step)}
      />
    </div>
  );
}

export { describeStep, listMacros };
