import { useState } from 'react';
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
export function TabsPanel({ jobs, library, memoryPercent }: Props) {
  const [filter, setFilter] = useState<TabFilter>('all');
  const tabs = openTabs(jobs);
  const visible = tabs.filter(t => matchesFilter(t.worker, filter));
  const problems = tabs.filter(t => isProblem(t.worker)).length;
  const launchErrors = [...new Set(tabs.map(t => t.job.launch_error).filter(Boolean))];

  return (
    <div className="card">
      <h2>Вкладки</h2>
      <details className="fold tabs-library">
        <summary>Сохранённые сценарии · {libraryCount(library.scenarios, library.macros)}</summary>
        <ScenariosPage library={library} />
      </details>

      {tabs.length > 0 && <TabsToolbar tabs={tabs} filter={filter} onFilter={setFilter} />}
      {launchErrors.map(error => (
        <p className="note warn" role="status" key={error}>
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
            Нет активных вкладок.
            <br />
            <b>После запуска карточки появятся здесь.</b>
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
