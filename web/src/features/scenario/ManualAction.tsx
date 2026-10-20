import { useState } from 'react';
import type { ActionName, Kind, Step } from '@/lib/types';
import {
  KIND_OPTIONS,
  MANUAL_ACTIONS,
  NEEDS_ELEMENT,
  NEEDS_VALUE,
  VALUE_PLACEHOLDERS,
} from './manualActions';

interface Props {
  onSubmit: (step: Step) => void;
}

const inRange = (text: string) => text !== '' && Number(text) >= 0 && Number(text) <= 100;

/** Одно действие вручную: выполняется в этой вкладке и попадает в запись, если она идёт. */
export function ManualAction({ onSubmit }: Props) {
  const [action, setAction] = useState<ActionName>('click');
  const [kind, setKind] = useState('css');
  const [query, setQuery] = useState('');
  const [value, setValue] = useState('');
  const [x, setX] = useState('');
  const [y, setY] = useState('');

  const isPoint = action === 'point';
  const valid = !isPoint || (inRange(x) && inRange(y));

  const submit = () => {
    const step: Step = { action, query, value };
    if (kind.startsWith('role:')) {
      step.kind = 'role';
      step.role = kind.slice(5);
    } else {
      step.kind = kind as Kind;
    }
    if (isPoint) {
      step.x = Number(x) / 100;
      step.y = Number(y) / 100;
    }
    onSubmit(step);
  };

  return (
    <details className="fold manual-action">
      <summary>Ручное действие · точная настройка</summary>
      <form
        className="manual-form"
        onSubmit={e => {
          e.preventDefault();
          if (valid) submit();
        }}
      >
        <div className="manual-grid">
          <select
            value={action}
            aria-label="Действие"
            onChange={e => setAction(e.target.value as ActionName)}
          >
            {MANUAL_ACTIONS.map(a => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          {NEEDS_ELEMENT.has(action) && (
            <select value={kind} aria-label="Найти элемент" onChange={e => setKind(e.target.value)}>
              {KIND_OPTIONS.map(k => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          )}
          {NEEDS_ELEMENT.has(action) && (
            <input
              className="manual-query"
              value={query}
              placeholder="Элемент: CSS, текст, роль или label"
              aria-label="Элемент"
              onChange={e => setQuery(e.target.value)}
            />
          )}
          {NEEDS_VALUE.has(action) && (
            <input
              className="manual-value"
              value={value}
              placeholder={VALUE_PLACEHOLDERS[action] || 'Значение'}
              aria-label="Значение"
              onChange={e => setValue(e.target.value)}
            />
          )}
          {isPoint && (
            <>
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={x}
                placeholder="X, %"
                aria-label="Координата X, %"
                onChange={e => setX(e.target.value)}
              />
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={y}
                placeholder="Y, %"
                aria-label="Координата Y, %"
                onChange={e => setY(e.target.value)}
              />
            </>
          )}
        </div>
        <p className="hint">
          {valid
            ? 'Действие выполняется только в этой вкладке и записывается, если идёт запись.'
            : 'Укажи X и Y в процентах от 0 до 100.'}
        </p>
        <button type="submit" className="btn btn-accent manual-submit" disabled={!valid}>
          Выполнить действие
        </button>
      </form>
    </details>
  );
}
