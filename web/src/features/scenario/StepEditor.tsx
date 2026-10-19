import { useState, type ReactNode } from 'react';
import type { Step } from '@/lib/types';

interface Props {
  index: number;
  step: Step;
  onSave: (step: Step) => void;
  onRemove: () => void;
}

type Patch = (change: Partial<Step>) => void;

/** Доли ширины/высоты (0–1) ↔ проценты с одним знаком после запятой. */
const toPercent = (fraction: number | undefined) => Math.round((fraction || 0) * 1000) / 10;

function waitFields(draft: Step, patch: Patch): ReactNode {
  const seconds = Number(draft.value || draft.duration_ms || 0) / 1000;
  return (
    <label>
      Пауза, секунды
      <input
        type="number"
        min={0}
        max={60}
        step={0.1}
        value={seconds}
        onChange={e =>
          patch({ value: String(Math.round(Number(e.target.value) * 1000)), duration_ms: undefined })
        }
      />
    </label>
  );
}

function pointFields(draft: Step, patch: Patch): ReactNode {
  const scroll = draft.scroll_state;
  return (
    <>
      <label>
        X, %
        <input
          type="number"
          min={0}
          max={100}
          step={0.1}
          value={toPercent(draft.x)}
          onChange={e => patch({ x: Number(e.target.value) / 100 })}
        />
      </label>
      <label>
        Y, %
        <input
          type="number"
          min={0}
          max={100}
          step={0.1}
          value={toPercent(draft.y)}
          onChange={e => patch({ y: Number(e.target.value) / 100 })}
        />
      </label>
      <label>
        Селектор
        <input value={draft.query || ''} onChange={e => patch({ query: e.target.value })} />
      </label>
      {scroll && (
        <label>
          Прокрутка страницы, px
          <input
            type="number"
            min={0}
            value={scroll.y}
            onChange={e => patch({ scroll_state: { ...scroll, y: Number(e.target.value) } })}
          />
        </label>
      )}
    </>
  );
}

function textFields(draft: Step, patch: Patch): ReactNode {
  return (
    <>
      {draft.query !== undefined && (
        <label>
          Селектор
          <input value={draft.query} onChange={e => patch({ query: e.target.value })} />
        </label>
      )}
      {draft.value !== undefined && (
        <label>
          Значение
          <input value={draft.value} onChange={e => patch({ value: e.target.value })} />
        </label>
      )}
    </>
  );
}

function fieldsFor(draft: Step, patch: Patch): ReactNode {
  if (draft.action === 'wait') return waitFields(draft, patch);
  if (draft.action === 'point') return pointFields(draft, patch);
  return textFields(draft, patch);
}

/** Встроенный редактор одного шага; черновик живёт локально до «Сохранить шаг». */
export function StepEditor({ index, step, onSave, onRemove }: Props) {
  const [draft, setDraft] = useState<Step>(() => structuredClone(step));
  const patch: Patch = change => setDraft(current => ({ ...current, ...change }));

  return (
    <form
      className="step-editor"
      onSubmit={e => {
        e.preventDefault();
        onSave(draft);
      }}
    >
      <strong>Изменить шаг {index + 1}</strong>
      <div className="step-editor-fields">{fieldsFor(draft, patch)}</div>
      <div className="step-editor-actions">
        <button type="submit" className="btn btn-sm btn-accent">
          Сохранить шаг
        </button>
        <button type="button" className="btn btn-sm btn-ghost step-editor-delete" onClick={onRemove}>
          Удалить шаг
        </button>
      </div>
    </form>
  );
}
