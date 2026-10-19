import { stopAll } from '@/api/tabs';
import { cx } from '@/lib/cx';
import { toastResult } from '@/lib/toast';
import type { Worker } from '@/lib/types';
import type { OpenTab } from './TabsPanel';

export type TabFilter = 'all' | 'watching' | 'problem';

export const isProblem = (worker: Worker) => ['error', 'blocked', 'paused'].includes(worker.state);

export const matchesFilter = (worker: Worker, filter: TabFilter) =>
  filter === 'all' || (filter === 'watching' ? worker.state === 'watching' : isProblem(worker));

interface Props {
  tabs: OpenTab[];
  filter: TabFilter;
  onFilter: (filter: TabFilter) => void;
}

/** Счётчик, фильтр по состоянию и «Закрыть все» над сеткой вкладок. */
export function TabsToolbar({ tabs, filter, onFilter }: Props) {
  const options: { id: TabFilter; label: string; count: number }[] = [
    { id: 'all', label: 'Все', count: tabs.length },
    { id: 'watching', label: 'Играют', count: tabs.filter(t => t.worker.state === 'watching').length },
    { id: 'problem', label: 'Проблемы', count: tabs.filter(t => isProblem(t.worker)).length },
  ];

  const closeAll = async () => {
    if (!confirm(`Закрыть все ${tabs.length} активных вкладок?`)) return;
    toastResult(await stopAll(), 'Вкладки закрываются', 'Не удалось закрыть вкладки');
  };

  return (
    <div className="tabs-toolbar" aria-label="Фильтр вкладок">
      <span className="tabs-count">
        Активных вкладок: <b>{tabs.length}</b>
      </span>
      <div className="tabs-filters">
        {options.map(option => (
          <button
            key={option.id}
            type="button"
            className={cx('btn btn-sm', filter === option.id && 'on')}
            aria-pressed={filter === option.id}
            onClick={() => onFilter(option.id)}
          >
            {option.label} <span>{option.count}</span>
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-sm btn-danger" onClick={closeAll}>
        Закрыть все
      </button>
    </div>
  );
}
