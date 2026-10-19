import { deleteMacro, runMacro } from '@/api/automation';
import type { Library } from '@/hooks/useLibrary';
import { describeStep } from '@/lib/steps';
import { stepsCount } from '@/lib/text';
import { toast, toastResult } from '@/lib/toast';
import type { Job } from '@/lib/types';
import { activeTab } from './activeTab';
import { AutoItem } from './AutoItem';

interface Props {
  jobs: Job[];
  library: Library;
}

/** Макросы — сценарии на сервере, видные MCP-агентам. Запуск — в последней своей вкладке. */
export function MacrosPanel({ jobs, library }: Props) {
  const runInActive = async (name: string) => {
    const tab = activeTab(jobs);
    if (!tab) {
      toast('Сначала открой вкладку', 'err');
      return;
    }
    const r = await runMacro(name, tab.job, tab.worker);
    if (!r.ok) {
      toast(r.error || 'Макрос остановился с ошибкой', 'err');
      return;
    }
    toast(`Макрос выполнен во вкладке ${tab.name}: ${stepsCount(r.completed)}`);
  };

  const remove = async (name: string) => {
    if (!confirm(`Удалить макрос «${name}»?`)) return;
    toastResult(await deleteMacro(name), 'Удалено');
    library.refresh();
  };

  return (
    <div className="auto-col">
      <h3>
        Макросы
        <button type="button" className="btn btn-sm btn-ghost" onClick={library.refresh}>
          Обновить
        </button>
      </h3>
      <div className="auto-list">
        {library.macros.map(m => (
          <AutoItem
            key={m.name}
            name={m.name}
            meta={`${stepsCount(m.steps.length)}: ${m.steps.slice(0, 3).map(describeStep).join(' → ')}`}
          >
            <button type="button" className="btn btn-sm btn-info" onClick={() => runInActive(m.name)}>
              ▶ В активной вкладке
            </button>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              title="Удалить"
              onClick={() => remove(m.name)}
            >
              ✕
            </button>
          </AutoItem>
        ))}
        {!library.macros.length && <p className="auto-empty">Запиши шаги во вкладке и нажми «Сохранить».</p>}
      </div>
      <p className="hint">
        Серверные сценарии видят MCP-агенты. «▶ В активной вкладке» запускает макрос в твоей последней
        открытой вкладке.
      </p>
    </div>
  );
}
