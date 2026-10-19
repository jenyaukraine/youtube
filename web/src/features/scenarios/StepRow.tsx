import type { MouseEvent } from 'react';
import { describeStep } from '@/lib/steps';
import type { Step } from '@/lib/types';
import { StepFields } from './StepFields';

interface Props {
  index: number;
  step: Step;
  last: boolean;
  picked: boolean;
  onPick: () => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onPatch: (part: Partial<Step>) => void;
}

// Кнопки в summary не должны сворачивать шаг.
const stop = (e: MouseEvent) => e.stopPropagation();

/** Один шаг: свёрнутая строка с описанием и кнопками, внутри — поля. */
export function StepRow({ index, step, last, picked, onPick, onMove, onRemove, onPatch }: Props) {
  const act = (fn: () => void) => (e: MouseEvent) => {
    stop(e);
    fn();
  };

  return (
    <details className="scn-step">
      <summary className="scn-step-head">
        <input
          type="checkbox"
          className="scn-step-pick"
          checked={picked}
          onClick={stop}
          onChange={onPick}
          aria-label={`Выбрать шаг ${index + 1}`}
        />
        <strong>Шаг {index + 1}</strong>
        <span className="scn-step-summary">{describeStep(step)}</span>
        <span className="scn-step-ops">
          <button
            type="button"
            className="btn btn-sm"
            title="Вверх"
            disabled={index === 0}
            onClick={act(() => onMove(-1))}
          >
            ↑
          </button>
          <button
            type="button"
            className="btn btn-sm"
            title="Вниз"
            disabled={last}
            onClick={act(() => onMove(1))}
          >
            ↓
          </button>
          <button type="button" className="btn btn-sm btn-danger" title="Удалить" onClick={act(onRemove)}>
            ×
          </button>
        </span>
      </summary>
      <StepFields step={step} onPatch={onPatch} />
    </details>
  );
}
