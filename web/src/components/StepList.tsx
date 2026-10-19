import { useState } from 'react';
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
  onPatch: (index: number, step: Step) => void;
  onRemove: (index: number) => void;
}

/** Список записанных шагов: клик по тексту — точка старта, чекбокс — выбор для удаления. */
export function StepList({ steps, from, picked, onPickStart, onToggle, onDelete, onUnpick, onPatch, onRemove }: Props) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Step | null>(null);
  const patch = (change: Partial<Step>) => setDraft(current => current ? { ...current, ...change } : current);
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
            <button type="button" className="step-edit" aria-label={`Изменить шаг ${i + 1}`} onClick={() => { setEditing(editing === i ? null : i); setDraft(structuredClone(step)); }}>✎</button>
            {editing === i && draft && <form className="scenario-step-editor" onSubmit={e => { e.preventDefault(); onPatch(i, draft); setEditing(null); }}>
              <strong>Изменить шаг {i + 1}</strong>
              {draft.action === 'wait' ? <label>Пауза, секунды<input type="number" min={0} max={60} step={0.1} value={Number(draft.value || draft.duration_ms || 0) / 1000} onChange={e => patch({ value: String(Math.round(Number(e.target.value) * 1000)), duration_ms: undefined })} /></label>
                : draft.action === 'point' ? <>
                    <label>X, %<input type="number" min={0} max={100} step={0.1} value={Math.round((draft.x || 0) * 1000) / 10} onChange={e => patch({ x: Number(e.target.value) / 100 })} /></label>
                    <label>Y, %<input type="number" min={0} max={100} step={0.1} value={Math.round((draft.y || 0) * 1000) / 10} onChange={e => patch({ y: Number(e.target.value) / 100 })} /></label>
                    <label>Селектор<input value={draft.query || ''} onChange={e => patch({ query: e.target.value })} /></label>
                    {draft.scroll_state && <label>Прокрутка страницы, px<input type="number" min={0} value={draft.scroll_state.y} onChange={e => patch({ scroll_state: { ...draft.scroll_state!, y: Number(e.target.value) } })} /></label>}
                  </> : <>
                    {draft.query !== undefined && <label>Селектор<input value={draft.query} onChange={e => patch({ query: e.target.value })} /></label>}
                    {draft.value !== undefined && <label>Значение<input value={draft.value} onChange={e => patch({ value: e.target.value })} /></label>}
                  </>}
              <button type="submit">Сохранить шаг</button><button type="button" className="step-editor-delete" onClick={() => { onRemove(i); setEditing(null); }}>Удалить шаг</button>
            </form>}
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
