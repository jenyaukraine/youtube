import { useState } from 'react';
import type { Recorder } from '@/hooks/useRecorder';
import { cx } from '@/lib/cx';
import { describeStep } from '@/lib/steps';
import { StepEditor } from './StepEditor';

interface Props {
  recorder: Recorder;
}

/** Записанные шаги: чекбокс — выбор для удаления (shift — диапазон), клик по тексту — точка старта повтора. */
export function StepList({ recorder }: Props) {
  const { steps, from, picked } = recorder;
  const [editing, setEditing] = useState<number | null>(null);

  if (!steps.length) {
    return <p className="hint step-list-empty">Пока нет записанных действий</p>;
  }

  const startTitle = (i: number) =>
    i === from && from > 0 ? 'Повтор начнётся отсюда · нажми, чтобы снять' : 'Нажми — повторять с этого шага';

  return (
    <>
      <ol className="step-list">
        {steps.map((step, i) => (
          <li
            key={i}
            className={cx({
              from: i === from && from > 0,
              skipped: i < from,
              picked: picked.has(i),
              editing: editing === i,
            })}
          >
            <input
              type="checkbox"
              className="step-pick"
              checked={picked.has(i)}
              aria-label={`Выбрать шаг ${i + 1}`}
              // readOnly лишь глушит предупреждение React: переключаем в onClick, где есть shiftKey.
              readOnly
              onClick={e => recorder.togglePick(i, e.shiftKey)}
            />
            <button
              type="button"
              className="step-text"
              title={startTitle(i)}
              onClick={() => recorder.pickStart(i)}
            >
              {describeStep(step)}
            </button>
            <button
              type="button"
              className="step-edit"
              aria-label={`Изменить шаг ${i + 1}`}
              aria-expanded={editing === i}
              onClick={() => setEditing(editing === i ? null : i)}
            >
              ✎
            </button>
            {editing === i && (
              <StepEditor
                index={i}
                step={step}
                onSave={next => {
                  recorder.patchStep(i, next);
                  setEditing(null);
                }}
                onRemove={() => {
                  recorder.removeStep(i);
                  setEditing(null);
                }}
              />
            )}
          </li>
        ))}
      </ol>
      {picked.size > 0 && (
        <div className="step-bulk">
          <span>
            Выбрано {picked.size} из {steps.length}
          </span>
          <button type="button" className="btn btn-sm step-bulk-delete" onClick={recorder.deletePicked}>
            Удалить выбранные
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={recorder.unpickAll}>
            Снять выбор
          </button>
        </div>
      )}
    </>
  );
}
