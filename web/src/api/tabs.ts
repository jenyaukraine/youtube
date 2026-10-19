import { controlToken, rememberControl } from '@/lib/storage';
import type { ActionResult, Step, StepsResult } from '@/lib/types';
import { api, enc, post } from './client';

export interface StartPayload {
  url: string;
  workers: number;
  duration: number;
  headers: Record<string, string>;
  user_agent_mode: string;
  profile?: string;
  steps?: Step[];
}

interface StartReply {
  id: string;
  workers: number;
  worker_ids: string[];
  control_token: string;
}

const worker = (job: string, id: string) => `/api/worker/${enc(job)}/${enc(id)}`;

export async function startTabs(payload: StartPayload) {
  const reply = await post<StartReply>('/api/start', payload);
  if (reply.ok) rememberControl(reply.id, reply.control_token, payload.steps);
  return reply;
}

export const stopJob = (job: string) => post(`/api/job/${enc(job)}/stop`);
export const stopWorker = (job: string, id: string) => post(worker(job, id) + '/stop');
export const reloadWorker = (job: string, id: string) => post(worker(job, id) + '/reload');

export const runAction = (job: string, id: string, step: Step) =>
  post<ActionResult>(worker(job, id) + '/action', { ...step, control_token: controlToken(job) });

export const runSteps = (job: string, id: string, steps: Step[], delay_ms = 300) =>
  post<StepsResult>(worker(job, id) + '/steps', { steps, delay_ms, control_token: controlToken(job) });

export const screenshotUrl = (job: string, id: string) =>
  `${worker(job, id)}/screenshot?force=1&t=${Date.now()}`;

export const listProfiles = () => api<{ profiles: { name: string }[] }>('/api/profiles');
