import { useState } from 'react';
import { stopAll, toast } from '../lib/api';
import type { Job, Macro, Scenario, Worker } from '../lib/types';
import { TabCard } from './TabCard';

type Tab = { job: Job; worker: Worker };
type Filter = 'all' | 'watching' | 'problem';
const isProblem = (worker: Worker) => ['error', 'blocked', 'paused'].includes(worker.state);

interface Props {
  tabs: Tab[];
  scenarios: Scenario[];
  macros: Macro[];
  memoryPercent: number;
  onScenariosChanged: () => void;
}

export function WorkersPanel({ tabs, scenarios, macros, memoryPercent, onScenariosChanged }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const watching = tabs.filter(({ worker }) => worker.state === 'watching').length;
  const problems = tabs.filter(({ worker }) => isProblem(worker)).length;
  const launchErrors = [...new Set(tabs.map(({ job }) => job.launch_error).filter(Boolean))];
  const visible = tabs.filter(({ worker }) => filter === 'all' ||
    (filter === 'watching' ? worker.state === 'watching' : isProblem(worker)));
  const options: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: 'Все', count: tabs.length },
    { id: 'watching', label: 'Играют', count: watching },
    { id: 'problem', label: 'Проблемы', count: problems },
  ];

  return <>
    {!!tabs.length && <div className="workers-toolbar" aria-label="Фильтр вкладок">
      <span className="workers-count">Активных вкладок: <b>{tabs.length}</b></span>
      <div className="workers-filters">{options.map(option => <button key={option.id} type="button"
        className={filter === option.id ? 'active' : ''} aria-pressed={filter === option.id}
        onClick={() => setFilter(option.id)}>
        {option.label} <span>{option.count}</span>
      </button>)}</div>
      <button type="button" className="workers-stop" onClick={async () => {
        if (!confirm(`Закрыть все ${tabs.length} активных вкладок?`)) return;
        const result = await stopAll();
        toast(result.ok ? 'Вкладки закрываются' : result.error || 'Не удалось закрыть вкладки', result.ok ? 'ok' : 'err');
      }}>Закрыть все</button>
    </div>}
    {launchErrors.map(error => <div className="workers-alert" role="status" key={error}>{error}</div>)}
    {memoryPercent >= 90 && <div className="workers-alert" role="status">
      Память занята на {memoryPercent}%. Закройте лишние вкладки перед новым запуском.
    </div>}
    {problems > 0 && <div className="workers-alert" role="status">
      Проблемы в {problems} вкладках. Проверьте одну вкладку отдельно; при ошибке YouTube сократите число открытых вкладок или попробуйте режим «Мой Chrome».
    </div>}
    <div className="workers">
      {!tabs.length && <div className="empty">Нет активных вкладок.<br /><b>После запуска карточки появятся здесь.</b></div>}
      {!!tabs.length && !visible.length && <div className="empty workers-empty">В этой группе вкладок нет.</div>}
      {visible.map(({ job, worker }) => <TabCard key={worker.id} job={job} worker={worker}
        scenarios={scenarios} macros={macros} onScenariosChanged={onScenariosChanged} />)}
    </div>
  </>;
}
