import type { ActionResult, FileItem, Job, Macro, Scenario, Step, StepsResult, Trigger, TriggerTestResult } from './types';

// ---------- токены ----------
export const TOKEN_KEY = 'katya_token';
export const SCENARIO_STORE = 'katya_scenarios_v1';
export const DRAFT_STORE = 'katya_recording_drafts_v1';

export function apiToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
export function setApiToken(value: string) {
  try { localStorage.setItem(TOKEN_KEY, value.trim()); } catch { /* приватный режим */ }
}
export function controlToken(jobId: string): string {
  try { return sessionStorage.getItem('katya_control_' + jobId) || ''; } catch { return ''; }
}
export function rememberControl(jobId: string, token: string, steps?: Step[]) {
  try {
    sessionStorage.setItem('katya_control_' + jobId, token);
    if (steps?.length) sessionStorage.setItem('katya_steps_' + jobId, JSON.stringify(steps));
  } catch { /* ignore */ }
}
export function rememberedSteps(jobId: string): Step[] | null {
  try { return JSON.parse(sessionStorage.getItem('katya_steps_' + jobId) || 'null'); } catch { return null; }
}
export function ownedJob(jobs: Job[]): Job | undefined {
  return jobs.find(j => j.status === 'running' && controlToken(j.id));
}

/** Заголовки, которыми панель подтверждает себя: API-ключ или своя открытая вкладка. */
export function authHeaders(jobs: Job[] = []): Record<string, string> {
  const h: Record<string, string> = {};
  const token = apiToken();
  if (token) h['X-Katya-Token'] = token;
  const own = ownedJob(jobs);
  if (own) { h['X-Katya-Job'] = own.id; h['X-Katya-Control-Token'] = controlToken(own.id); }
  return h;
}

let jobsForAuth: Job[] = [];
export function setJobsForAuth(jobs: Job[]) { jobsForAuth = jobs; }

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...authHeaders(jobsForAuth), ...(init.headers as Record<string, string> || {}) };
  try {
    const r = await fetch(path, { ...init, headers });
    return await r.json();
  } catch (e) {
    return { ok: false, error: 'Нет связи с сервером: ' + (e as Error).message } as T;
  }
}

// ---------- вкладки ----------
export interface StartPayload {
  url: string; workers: number; duration: number; headers: Record<string, string>;
  user_agent_mode: string; profile?: string; steps?: Step[];
}
export async function startTabs(payload: StartPayload) {
  const r = await api<{ ok: boolean; id?: string; workers?: number; worker_ids?: string[]; control_token?: string; error?: string }>('/api/start', { method: 'POST', body: JSON.stringify(payload) });
  if (r.ok && r.id && r.control_token) rememberControl(r.id, r.control_token, payload.steps);
  return r;
}
export const stopJob = (jobId: string) => api(`/api/job/${encodeURIComponent(jobId)}/stop`, { method: 'POST' });
export const stopAll = () => api('/api/stop', { method: 'POST' });
export const stopWorker = (job: string, worker: string) => api(`/api/worker/${encodeURIComponent(job)}/${encodeURIComponent(worker)}/stop`, { method: 'POST' });
export const reloadWorker = (job: string, worker: string) => api(`/api/worker/${encodeURIComponent(job)}/${encodeURIComponent(worker)}/reload`, { method: 'POST' });

export function runAction(job: string, worker: string, step: Step): Promise<ActionResult> {
  return api(`/api/worker/${encodeURIComponent(job)}/${encodeURIComponent(worker)}/action`, {
    method: 'POST', body: JSON.stringify({ ...step, control_token: controlToken(job) }),
  });
}
export function runSteps(job: string, worker: string, steps: Step[], delay_ms = 300): Promise<StepsResult> {
  return api(`/api/worker/${encodeURIComponent(job)}/${encodeURIComponent(worker)}/steps`, {
    method: 'POST', body: JSON.stringify({ steps, delay_ms, control_token: controlToken(job) }),
  });
}
export const screenshotUrl = (job: string, worker: string, force = true) =>
  `/api/worker/${encodeURIComponent(job)}/${encodeURIComponent(worker)}/screenshot?force=${force ? 1 : 0}&t=${Date.now()}`;

// ---------- триггеры ----------
export const listTriggers = () => api<{ ok: boolean; triggers: Trigger[] }>('/api/triggers');
export const saveTrigger = (t: Partial<Trigger>) => api<{ ok: boolean; trigger?: Trigger; error?: string }>('/api/triggers', { method: 'POST', body: JSON.stringify(t) });
export const deleteTrigger = (id: string) => api(`/api/triggers/${id}`, { method: 'DELETE' });
export const toggleTrigger = (id: string, enabled: boolean) => api(`/api/triggers/${id}/enabled?enabled=${enabled}`, { method: 'POST' });
export function testTrigger(when: Trigger['when'], then: Step[], job: string, worker: string, run: boolean): Promise<TriggerTestResult> {
  return api('/api/triggers/test', { method: 'POST', body: JSON.stringify({ when, then, job_id: job, worker_id: worker, run, control_token: controlToken(job) }) });
}

// ---------- макросы, файлы, профили ----------
export const listMacros = () => api<{ ok: boolean; macros: Macro[] }>('/api/macros');
export const saveMacro = (m: Macro) => api<{ ok: boolean; macro?: Macro; error?: string }>('/api/macros', { method: 'POST', body: JSON.stringify(m) });
export const deleteMacro = (name: string) => api(`/api/macros/${encodeURIComponent(name)}`, { method: 'DELETE' });
export const runMacro = (name: string, job: string, worker: string) =>
  api<StepsResult>(`/api/macros/${encodeURIComponent(name)}/run`, { method: 'POST', body: JSON.stringify({ job_id: job, worker_id: worker, control_token: controlToken(job) }) });
export const listFiles = () => api<{ ok: boolean; files?: FileItem[]; error?: string }>('/api/files');
export const deleteFile = (name: string) => api(`/api/files/${encodeURIComponent(name)}`, { method: 'DELETE' });
export const fileUrl = (name: string) => `/api/files/${encodeURIComponent(name)}?token=${encodeURIComponent(apiToken())}`;
export const listProfiles = () => api<{ ok: boolean; profiles: { name: string }[] }>('/api/profiles');

// ---------- локальные сценарии ----------
export function localScenarios(): Scenario[] {
  try { const d = JSON.parse(localStorage.getItem(SCENARIO_STORE) || '[]'); return Array.isArray(d) ? d : []; } catch { return []; }
}
export function saveLocalScenarios(list: Scenario[]) {
  try { localStorage.setItem(SCENARIO_STORE, JSON.stringify(list.slice(0, 50))); } catch { /* ignore */ }
}
export function newScenarioName(startUrl: string, count: number) {
  let host = '';
  try { host = new URL(startUrl).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
  return `${host || 'Сценарий'} · ${count} ${plural(count, 'шаг', 'шага', 'шагов')} · ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}
export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

// ---------- описания шагов (одна функция на все экраны) ----------
export const KIND_LABELS: Record<string, string> = { css: 'селектор', text: 'текст', role: 'роль', label: 'подпись', placeholder: 'placeholder', xpath: 'xpath' };
export const ACTION_LABELS: Record<string, string> = {
  navigate: 'Открыть URL', reload: 'Перезагрузить', back: 'Назад', click: 'Клик', wait_click: 'Дождаться и кликнуть', dblclick: 'Двойной клик',
  point: 'Клик по точке', move: 'Курсор', mouse_drag: 'Выделение мышью', inspect: 'Осмотр', fill: 'Заполнить', type: 'Ввод текста',
  press: 'Клавиша', hover: 'Навести', drag: 'Перетащить', scroll: 'Прокрутка', select: 'Выбрать', wait: 'Пауза', wait_for: 'Ждать появления',
  wait_gone: 'Ждать исчезновения', wait_url: 'Ждать URL', text: 'Прочитать текст', attribute: 'Атрибут', exists: 'Проверить', count: 'Посчитать',
  screenshot: 'Скриншот', page_text: 'Текст страницы',
};
export const pct = (v: unknown) => `${Math.round((Number(v) || 0) * 100)}%`;

export function describeStep(step?: Step | null): string {
  if (!step) return '';
  if (step.name && ['click', 'point', 'fill', 'hover'].includes(step.action)) return `${ACTION_LABELS[step.action] || step.action}: ${step.name}`;
  const q = step.query ? `${KIND_LABELS[step.kind || ''] || step.kind || ''} «${String(step.query).slice(0, 40)}»` : '';
  const v = step.value == null ? '' : String(step.value);
  const secret = /{{\s*password\s*}}/.test(v);
  const text = secret ? '••••••' : v.length > 28 ? `«${v.slice(0, 28)}…»` : `«${v}»`;
  switch (step.action) {
    case 'wait': return `Пауза ${((Number(step.duration_ms || v) || 0) / 1000).toFixed(1)} с`;
    case 'point': return `Клик по точке ${pct(step.x)}, ${pct(step.y)}`;
    case 'move': return `Курсор к ${pct(step.x)}, ${pct(step.y)}`;
    case 'mouse_drag': return `Выделение мышью ${pct(step.x)}, ${pct(step.y)} → ${pct(step.end_x)}, ${pct(step.end_y)}`;
    case 'click': return `Клик: ${q || 'элемент'}`;
    case 'wait_click': return `Дождаться и кликнуть: ${q}`;
    case 'dblclick': return `Двойной клик: ${q}`;
    case 'hover': return `Навести на ${q}`;
    case 'scroll': { const px = Number(v || 500); return q ? `Прокрутить к ${q}` : `Прокрутка ${px < 0 ? 'вверх' : 'вниз'} на ${Math.abs(px)} px`; }
    case 'type': return v ? `Ввод текста ${text}` : 'Ввод текста';
    case 'fill': return `Заполнить ${q} → ${v ? text : '…'}`;
    case 'select': return `Выбрать ${text} в ${q}`;
    case 'press': return `Клавиша ${v || '?'}`;
    case 'navigate': return `Открыть ${v.replace(/^https?:\/\//, '').slice(0, 48)}`;
    case 'reload': return 'Перезагрузить страницу';
    case 'back': return 'Назад';
    case 'wait_for': return `Ждать появления ${q}`;
    case 'wait_gone': return `Ждать исчезновения ${q}`;
    case 'wait_url': return `Ждать URL ${text}`;
    case 'screenshot': return `Скриншот${step.name ? ' «' + step.name + '»' : ''}`;
    case 'page_text': return 'Прочитать текст страницы';
    case 'text': return `Прочитать текст ${q}`;
    case 'exists': case 'count': return `Проверить ${q}`;
    case 'attribute': return `Атрибут ${v} у ${q}`;
    case 'drag': return `Перетащить ${q} → ${text}`;
    case 'inspect': return 'Осмотр элемента';
    default: return (ACTION_LABELS[step.action] || step.action) + (q ? ' ' + q : '') + (v ? ' ' + text : '');
  }
}

/** Какие поля редактора нужны действию. */
export const STEP_FIELDS: Record<string, string[]> = {
  wait: ['value'], point: ['x', 'y'], move: ['x', 'y'], mouse_drag: ['x', 'y', 'end_x', 'end_y'],
  click: ['kind', 'query'], wait_click: ['kind', 'query'], dblclick: ['kind', 'query'], hover: ['kind', 'query'],
  fill: ['kind', 'query', 'value'], select: ['kind', 'query', 'value'], drag: ['kind', 'query', 'value'],
  type: ['value', 'kind', 'query'], press: ['value'], scroll: ['value', 'kind', 'query'], navigate: ['value'],
  wait_for: ['kind', 'query'], wait_gone: ['kind', 'query'], wait_url: ['value'], text: ['kind', 'query'],
  attribute: ['kind', 'query', 'value'], exists: ['kind', 'query'], count: ['kind', 'query'], screenshot: ['value'],
  page_text: ['value'], reload: [], back: [], inspect: ['x', 'y'],
};
export const STEP_HINTS: Record<string, string> = {
  wait: 'Пауза в миллисекундах: 1000 = 1 секунда.', point: 'Точка на кадре в долях ширины и высоты: 0.5, 0.5 — центр.',
  move: 'Курсор переместится в точку без клика.', mouse_drag: 'Нажать в точке X/Y, протянуть до «Конец X/Y», отпустить.',
  click: 'Способ поиска и сам элемент: CSS-селектор, видимый текст, роль или подпись.',
  wait_click: 'Ждёт появления элемента до 2 минут и кликает один раз.', fill: 'Очищает поле и вводит значение; можно {{переменную}}.',
  type: 'Печатает по буквам в активное поле; элемент указывать не обязательно.', press: 'Клавиша: Enter, Escape, Tab, ArrowDown, Control+A.',
  scroll: 'Пикселей прокрутки: положительное — вниз, отрицательное — вверх. Или элемент, к которому прокрутить.',
  navigate: 'Полный адрес с http:// или https://.', drag: 'Элемент-источник слева, элемент-цель в значении.',
  select: 'Значение option в выпадающем списке.', screenshot: '«full» — вся страница, иначе видимая часть.',
};

export function toast(msg: string, type: 'ok' | 'err' = 'ok') {
  window.dispatchEvent(new CustomEvent('katya-toast', { detail: { msg, type } }));
}
