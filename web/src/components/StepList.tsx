import { describeStep } from '../lib/api';
import type { Step } from '../lib/types';

interface Props {
  steps: Step[];
  from: number;
  picked: Set<number>;
  onPickStart: (index: number) => void;
  onToggle: (index: number, shift: boolean) => void;
  onDelete: () => void;
  onUnpick: () => void;
}

/** Список записанных шагов: клик по тексту — точка старта, чекбокс — выбор для удаления. */
export function StepList({ steps, from, picked, onPickStart, onToggle, onDelete, onUnpick }: Props) {
  return (
    <>
      <ol className="recorded-steps">
        {steps.map((step, i) => (
          <li key={i} data-index={i}
              className={[i === from && from > 0 ? 'from' : '', i < from ? 'skipped' : '', picked.has(i) ? 'picked' : ''].join(' ').trim()}
              title={i === from && from ? 'Повтор начнётся отсюда · нажми, чтобы снять' : 'Нажми — повторять с этого шага'}>
            <input type="checkbox" className="step-pick" checked={picked.has(i)} aria-label={`Выбрать шаг ${i + 1}`}
                   onClick={e => { e.stopPropagation(); onToggle(i, (e as unknown as MouseEvent).shiftKey); }} onChange={() => undefined} />
            <span className="step-text" onClick={() => onPickStart(i)}>{describeStep(step)}</span>
          </li>
        ))}
      </ol>
      {picked.size > 0 && (
        <div className="steps-bulk">
          <span className="steps-bulk-t">Выбрано: {picked.size} из {steps.length}</span>
          <button type="button" className="steps-delete" onClick={onDelete}>Удалить выбранные</button>
          <button type="button" className="steps-unpick" onClick={onUnpick}>Снять выбор</button>
        </div>
      )}
    </>
  );
}
