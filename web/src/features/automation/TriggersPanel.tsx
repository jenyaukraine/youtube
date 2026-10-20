import { deleteTrigger, toggleTrigger } from '@/api/automation';
import { cx } from '@/lib/cx';
import { describeStep } from '@/lib/steps';
import { toast, toastResult } from '@/lib/toast';
import type { Job, Trigger } from '@/lib/types';
import { AutoItem } from './AutoItem';
import { TriggerForm } from './TriggerForm';
import { useTriggerTest } from './useTriggerTest';

interface Props {
  jobs: Job[];
  triggers: Trigger[];
}

/** Триггеры: когда на странице появится X → сделать Y. Список приходит из live-состояния. */
export function TriggersPanel({ jobs, triggers }: Props) {
  const { note, test } = useTriggerTest(jobs);

  const remove = async (id: string) => {
    toastResult(await deleteTrigger(id), 'Триггер удалён');
  };

  const toggle = async (trigger: Trigger) => {
    const r = await toggleTrigger(trigger.id, !trigger.enabled);
    if (!r.ok) toast(r.error || 'Не удалось переключить', 'err');
  };

  return (
    <div className="auto-col">
      <h3>
        Триггеры <span className="hint">когда появится → сделать</span>
      </h3>
      <div className="auto-list">
        {triggers.map(t => (
          <AutoItem
            key={t.id}
            name={`${t.name} · сработал ${t.fired}×`}
            meta={`${t.when.kind}: ${t.when.query} → ${t.then.map(describeStep).join(', ')}`}
          >
            <button
              type="button"
              className="btn btn-sm"
              title="Проверить на активной вкладке"
              onClick={() => test(t.when, t.then, false)}
            >
              Тест
            </button>
            <button
              type="button"
              className="btn btn-sm btn-info"
              title="Выполнить реакцию"
              onClick={() => test(t.when, t.then, true)}
            >
              ▶
            </button>
            <button
              type="button"
              className={cx('btn btn-sm', t.enabled ? 'btn-accent' : 'btn-ghost')}
              onClick={() => toggle(t)}
            >
              {t.enabled ? 'Вкл' : 'Выкл'}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              title="Удалить"
              onClick={() => remove(t.id)}
            >
              ✕
            </button>
          </AutoItem>
        ))}
        {!triggers.length && (
          <p className="auto-empty">
            Пока нет триггеров. Пример: когда виден текст «Принять все» → кликнуть по нему.
          </p>
        )}
      </div>
      <TriggerForm note={note} onTest={test} />
    </div>
  );
}
