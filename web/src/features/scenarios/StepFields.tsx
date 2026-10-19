import { ACTION_LABELS, KIND_LABELS, STEP_FIELDS, STEP_HINTS, type StepField } from '@/lib/steps';
import type { ActionName, Kind, Step } from '@/lib/types';
import { ScrollStateFields } from './ScrollStateFields';

interface Props {
  step: Step;
  onPatch: (part: Partial<Step>) => void;
}

const ACTIONS = Object.keys(ACTION_LABELS) as ActionName[];

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const KINDS = (Object.entries(KIND_LABELS) as [Kind, string][]).map(([v, l]) => [v, capitalize(l)] as const);

const PLACEHOLDERS: Partial<Record<ActionName, string>> = {
  press: 'Enter',
  scroll: '600',
  navigate: 'https://…',
  type: '{{username}}',
};

const COORDS: { key: 'x' | 'y' | 'end_x' | 'end_y'; label: string }[] = [
  { key: 'x', label: 'X (0–1)' },
  { key: 'y', label: 'Y (0–1)' },
  { key: 'end_x', label: 'Конец X (0–1)' },
  { key: 'end_y', label: 'Конец Y (0–1)' },
];

/** Поля шага по его действию (см. STEP_FIELDS); пауза редактируется в секундах, хранится в мс. */
export function StepFields({ step, onPatch }: Props) {
  const fields = STEP_FIELDS[step.action];
  const has = (field: StepField) => fields.includes(field);
  const isWait = step.action === 'wait';

  const valueText = isWait ? String(Number(step.value || step.duration_ms || 0) / 1000) : step.value || '';
  const changeValue = (raw: string) =>
    onPatch({ value: isWait ? String(Math.round(Number(raw) * 1000)) : raw });

  return (
    <div className="scn-step-grid">
      <div>
        <label>Действие</label>
        <select value={step.action} onChange={e => onPatch({ action: e.target.value as ActionName })}>
          {ACTIONS.map(a => (
            <option key={a} value={a}>
              {ACTION_LABELS[a]}
            </option>
          ))}
        </select>
      </div>
      {has('kind') && (
        <div>
          <label>Поиск элемента</label>
          <select value={step.kind || 'css'} onChange={e => onPatch({ kind: e.target.value as Kind })}>
            {KINDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}
      {has('query') && (
        <div>
          <label>Элемент / селектор</label>
          <input
            value={step.query || ''}
            onChange={e => onPatch({ query: e.target.value })}
            placeholder="button, Продолжить, Email"
          />
        </div>
      )}
      {has('value') && (
        <div>
          <label>{isWait ? 'Пауза, секунды' : 'Значение / {{переменная}}'}</label>
          <input
            type={isWait ? 'number' : 'text'}
            min={isWait ? 0 : undefined}
            max={isWait ? 60 : undefined}
            step={isWait ? 0.1 : undefined}
            value={valueText}
            onChange={e => changeValue(e.target.value)}
            placeholder={PLACEHOLDERS[step.action] || ''}
          />
        </div>
      )}
      {COORDS.filter(c => has(c.key)).map(c => (
        <div key={c.key}>
          <label>{c.label}</label>
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={step[c.key] ?? 0}
            onChange={e => onPatch({ [c.key]: Number(e.target.value) })}
          />
        </div>
      ))}
      {step.action === 'point' && step.scroll_state && (
        <ScrollStateFields state={step.scroll_state} onChange={scroll_state => onPatch({ scroll_state })} />
      )}
      <p className="scn-wide hint">{STEP_HINTS[step.action] || 'Укажи способ поиска и элемент.'}</p>
    </div>
  );
}
