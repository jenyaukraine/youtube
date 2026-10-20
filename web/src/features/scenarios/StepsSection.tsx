import { useState } from 'react';
import type { Step } from '@/lib/types';
import { StepRow } from './StepRow';

interface Props {
  steps: Step[];
  onChange: (steps: Step[]) => void;
}

const NEW_STEP: Step = { action: 'click', kind: 'css', query: '', value: '' };

const toggled = (set: Set<number>, index: number) => {
  const next = new Set(set);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
};

const swapped = (steps: Step[], a: number, b: number) => {
  const next = [...steps];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
};

/** Список шагов с отметкой чекбоксами и удалением списком. */
export function StepsSection({ steps, onChange }: Props) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const unpick = () => setPicked(new Set());

  // Перестановка и удаление сдвигают индексы — выбор сбрасываем.
  const restructure = (next: Step[]) => {
    onChange(next);
    unpick();
  };

  const add = () => onChange([...steps, { ...NEW_STEP }]);
  const patch = (index: number, part: Partial<Step>) =>
    onChange(steps.map((s, i) => (i === index ? { ...s, ...part } : s)));
  const move = (index: number, delta: -1 | 1) => restructure(swapped(steps, index, index + delta));
  const remove = (index: number) => restructure(steps.filter((_, i) => i !== index));
  const removePicked = () => restructure(steps.filter((_, i) => !picked.has(i)));

  return (
    <section className="scn-section">
      <div className="scn-section-head">
        <div>
          <h3>Шаги</h3>
          <p className="hint">Поля зависят от действия. Чекбоксы — для удаления списком.</p>
        </div>
        <button type="button" className="btn" onClick={add}>
          + Шаг
        </button>
      </div>
      {picked.size > 0 && (
        <div className="scn-bulk">
          <span>
            Выбрано: {picked.size} из {steps.length}
          </span>
          <button type="button" className="btn btn-sm btn-danger" onClick={removePicked}>
            Удалить выбранные
          </button>
          <button type="button" className="btn btn-sm" onClick={unpick}>
            Снять выбор
          </button>
        </div>
      )}
      <div className="scn-steps">
        {steps.map((step, i) => (
          <StepRow
            key={i}
            index={i}
            step={step}
            last={i === steps.length - 1}
            picked={picked.has(i)}
            onPick={() => setPicked(p => toggled(p, i))}
            onMove={delta => move(i, delta)}
            onRemove={() => remove(i)}
            onPatch={part => patch(i, part)}
          />
        ))}
        {!steps.length && (
          <p className="hint">Шагов пока нет. Запиши действия во вкладке или добавь шаг здесь.</p>
        )}
      </div>
    </section>
  );
}
