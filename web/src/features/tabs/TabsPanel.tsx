import { useEffect, useState } from 'react';
import { ScenariosPage } from '@/features/scenarios/ScenariosPage';
import type { Library } from '@/hooks/useLibrary';
import { libraryCount } from '@/lib/sources';
import type { Job, Worker } from '@/lib/types';
import { TabCard } from './TabCard';
import { TabsToolbar, isProblem, matchesFilter, type TabFilter } from './TabsToolbar';
import './tabs.css';

const MEMORY_ALERT_PERCENT = 90;

interface Props {
  jobs: Job[];
  online: boolean;
  library: Library;
  memoryPercent: number;
}

export interface OpenTab {
  job: Job;
  worker: Worker;
}

/** Живые вкладки всех запущенных задач. */
export const openTabs = (jobs: Job[]): OpenTab[] =>
  jobs
    .filter(job => job.status === 'running')
    .flatMap(job =>
      job.workers_list.filter(worker => worker.state !== 'stopped').map(worker => ({ job, worker })),
    );

/** Карточка «Вкладки»: сохранённые сценарии, фильтр, предупреждения и сетка живых вкладок. */
export function TabsPanel({ jobs, online, library, memoryPercent }: Props) {
  const [filter, setFilter] = useState<TabFilter>('all');
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() / 1000), 5000);
    return () => window.clearInterval(timer);
  }, []);
  const tabs = openTabs(jobs);
  const visible = tabs.filter(t => matchesFilter(t.worker, filter));
  const problems = tabs.filter(t => isProblem(t.worker)).length;
  const recent = jobs.filter(job => now - job.created < 300);
  const launching = recent.some(job => job.status === 'pending' || (job.status === 'running' && !job.workers_list.length));
  const launchErrors = [...new Set(recent.filter(job => job.status === 'running' || job.status === 'error').flatMap(job => {
    if (job.launch_error) return [job.launch_error];
    return job.status === 'error' ? [`Не удалось запустить браузер для ${job.url}. Подробности в «Диагностике сервера».`] : [];
  }))];

  return (
    <div className="card">
      <h2>Вкладки</h2>
      <details className="fold tabs-library">
        <summary>Сохранённые сценарии · {libraryCount(library.scenarios, library.macros)}</summary>
        <ScenariosPage library={library} />
      </details>

      {tabs.length > 0 && <TabsToolbar tabs={tabs} filter={filter} onFilter={setFilter} />}
      {!online && <p className="note warn" role="status">Нет связи с сервером состояния. Переподключаемся…</p>}
      {launchErrors.map(error => (
        <p className="note warn" role="alert" key={error}>
          {error}
        </p>
      ))}
      {memoryPercent >= MEMORY_ALERT_PERCENT && (
        <p className="note warn" role="status">
          Память занята на {memoryPercent}%. Закройте лишние вкладки перед новым запуском.
        </p>
      )}
      {problems > 0 && (
        <p className="note warn" role="status">
          Проблемы в {problems} вкладках. Проверьте одну вкладку отдельно; при ошибке YouTube сократите число
          открытых вкладок или попробуйте режим «Мой Chrome».
        </p>
      )}

      <div className="tabs-grid">
        {tabs.length === 0 && (
          <div className="empty">
            {launching ? 'Браузер запускается…' : 'Нет активных вкладок.'}
            <br />
            <b>{launching ? 'Карточки появятся после открытия страниц.' : 'После запуска карточки появятся здесь.'}</b>
          </div>
        )}
        {tabs.length > 0 && visible.length === 0 && <div className="empty">В этой группе вкладок нет.</div>}
        {visible.map(({ job, worker }) => (
          <TabCard key={worker.id} job={job} worker={worker} library={library} />
        ))}
      </div>
    </div>
  );
}
