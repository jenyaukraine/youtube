import type { Scenario, Step } from './types';

// Всё, что панель хранит в браузере. Хранилища могут быть недоступны (приватный режим) — ошибки глушим.

function read<T>(store: Storage, key: string, fallback: T): T {
  try {
    const raw = store.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(store: Storage, key: string, value: unknown) {
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    /* хранилище недоступно */
  }
}

const list = <T>(store: Storage, key: string): T[] => {
  const value = read<unknown>(store, key, []);
  return Array.isArray(value) ? (value as T[]) : [];
};

// ---------- ключи и режимы ----------
export const apiToken = () => read(localStorage, 'katya_token', '');
export const setApiToken = (value: string) => write(localStorage, 'katya_token', value.trim());

export const lastUrl = (fallback = 'https://') => read(localStorage, 'katya_last_url', fallback);
export const setLastUrl = (url: string) => write(localStorage, 'katya_last_url', url);

export type LaunchMode = 'playwright' | 'chrome';
export const launchMode = (): LaunchMode =>
  read<string>(localStorage, 'katya_launch_method', 'playwright') === 'chrome' ? 'chrome' : 'playwright';
export const setLaunchMode = (mode: LaunchMode) => write(localStorage, 'katya_launch_method', mode);

// ---------- управление своими вкладками (на время сессии) ----------
export const controlToken = (jobId: string) => read(sessionStorage, `katya_control_${jobId}`, '');

export function rememberControl(jobId: string, token: string, steps?: Step[]) {
  write(sessionStorage, `katya_control_${jobId}`, token);
  if (steps?.length) write(sessionStorage, `katya_steps_${jobId}`, steps);
}

export const rememberedSteps = (jobId: string) =>
  read<Step[] | null>(sessionStorage, `katya_steps_${jobId}`, null);

// ---------- сценарии в браузере ----------
const SCENARIOS = 'katya_scenarios_v1';
export const localScenarios = () => list<Scenario>(localStorage, SCENARIOS);
export const saveLocalScenarios = (items: Scenario[]) => write(localStorage, SCENARIOS, items.slice(0, 50));

export function addLocalScenario(scenario: Omit<Scenario, 'id' | 'createdAt'>): Scenario {
  const full: Scenario = { ...scenario, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  saveLocalScenarios([full, ...localScenarios()]);
  return full;
}

// ---------- черновики записи по вкладкам ----------
export interface Draft {
  key: string;
  startUrl: string;
  steps: Step[];
  updatedAt: number;
}

const DRAFTS = 'katya_recording_drafts_v1';
export const drafts = () => list<Draft>(localStorage, DRAFTS);

export function saveDraft(key: string, startUrl: string, steps: Step[]) {
  const rest = drafts().filter(d => d.key !== key);
  const next = steps.length
    ? [{ key, startUrl, steps: steps.slice(0, 200), updatedAt: Date.now() }, ...rest]
    : rest;
  write(localStorage, DRAFTS, next.slice(0, 30));
}

export const removeDraft = (key: string) => saveDraft(key, '', []);
