import { controlToken } from '@/lib/storage';
import type { Job } from '@/lib/types';

export interface ActiveTab {
  job: string;
  worker: string;
  name: string;
}

/** Активная вкладка для тестов и макросов: своя (с токеном управления), последняя открытая. */
export function activeTab(jobs: Job[]): ActiveTab | null {
  const own = jobs.filter(j => j.status === 'running' && controlToken(j.id)).reverse();
  for (const job of own) {
    const worker = job.workers_list.find(w => w.state !== 'stopped');
    if (worker) return { job: job.id, worker: worker.id, name: 'W-' + worker.id.split('-').pop() };
  }
  return null;
}
