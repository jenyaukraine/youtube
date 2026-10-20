import { apiToken, controlToken } from '@/lib/storage';
import type {
  FileItem,
  Macro,
  Step,
  StepsResult,
  Trigger,
  TriggerTestResult,
  TriggerWhen,
} from '@/lib/types';
import { api, del, enc, post } from './client';

// ---------- триггеры ----------
export const listTriggers = () => api<{ triggers: Trigger[] }>('/api/triggers');
export const saveTrigger = (trigger: Partial<Trigger>) =>
  post<{ trigger: Trigger }>('/api/triggers', trigger);
export const deleteTrigger = (id: string) => del(`/api/triggers/${enc(id)}`);
export const toggleTrigger = (id: string, enabled: boolean) =>
  post(`/api/triggers/${enc(id)}/enabled?enabled=${enabled}`);

export const testTrigger = (when: TriggerWhen, then: Step[], job: string, worker: string, run: boolean) =>
  post<TriggerTestResult>('/api/triggers/test', {
    when,
    then,
    job_id: job,
    worker_id: worker,
    run,
    control_token: controlToken(job),
  });

// ---------- макросы (сценарии на сервере) ----------
export const listMacros = () => api<{ macros: Macro[] }>('/api/macros');
export const saveMacro = (macro: Macro) => post<{ macro: Macro }>('/api/macros', macro);
export const deleteMacro = (name: string) => del(`/api/macros/${enc(name)}`);
export const runMacro = (name: string, job: string, worker: string) =>
  post<StepsResult>(`/api/macros/${enc(name)}/run`, {
    job_id: job,
    worker_id: worker,
    control_token: controlToken(job),
  });

// ---------- файлы ----------
export const listFiles = () => api<{ files: FileItem[] }>('/api/files');
export const deleteFile = (name: string) => del(`/api/files/${enc(name)}`);
export const fileUrl = (name: string) => `/api/files/${enc(name)}?token=${enc(apiToken())}`;
