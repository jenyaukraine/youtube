import { apiToken, controlToken } from '@/lib/storage';
import type { Job } from '@/lib/types';

/** Ответ с ошибкой может нести часть данных (например, completed у прерванного прогона). */
export type ApiError<T = object> = { ok: false; error: string } & Partial<T>;

export type ApiResult<T> = (T & { ok: true }) | ApiError<T>;

// Свои вкладки из последнего live-состояния: ими панель подтверждает себя без API-ключа.
let liveJobs: Job[] = [];
export const setLiveJobs = (jobs: Job[]) => (liveJobs = jobs);

export const ownedJob = (jobs: Job[] = liveJobs) =>
  jobs.find(j => j.status === 'running' && controlToken(j.id));

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = apiToken();
  if (token) headers['X-Katya-Token'] = token;
  const own = ownedJob();
  if (own) {
    headers['X-Katya-Job'] = own.id;
    headers['X-Katya-Control-Token'] = controlToken(own.id);
  }
  return headers;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const headers = {
    'Content-Type': 'application/json',
    ...authHeaders(),
    ...(init.headers as Record<string, string>),
  };
  try {
    const response = await fetch(path, { ...init, headers });
    return (await response.json()) as ApiResult<T>;
  } catch (error) {
    return { ok: false, error: `Нет связи с сервером: ${(error as Error).message}` };
  }
}

export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const del = <T = object>(path: string) => api<T>(path, { method: 'DELETE' });

export const enc = encodeURIComponent;
