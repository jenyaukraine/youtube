import { ScenariosPage } from '@/features/scenarios/ScenariosPage';
import type { Library } from '@/hooks/useLibrary';
import { libraryCount } from '@/lib/sources';
import type { Job, Worker } from '@/lib/types';
import { TabCard } from './TabCard';
import './tabs.css';

interface Props {
  jobs: Job[];
  library: Library;
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

/** Карточка «Вкладки»: сохранённые сценарии и сетка живых вкладок. */
export function TabsPanel({ jobs, library }: Props) {
  const tabs = openTabs(jobs);
  const saved = libraryCount(library.scenarios, library.macros);

  return (
    <div className="card">
      <h2>Вкладки</h2>
      <details className="fold tabs-library">
        <summary>Сохранённые сценарии · {saved}</summary>
        <ScenariosPage library={library} />
      </details>
      <div className="tabs-grid">
        {tabs.length === 0 && (
          <div className="empty">
            Нет активных вкладок.
            <br />
            <b>После запуска карточки появятся здесь.</b>
          </div>
        )}
        {tabs.map(({ job, worker }) => (
          <TabCard key={worker.id} job={job} worker={worker} library={library} />
        ))}
      </div>
    </div>
  );
}
