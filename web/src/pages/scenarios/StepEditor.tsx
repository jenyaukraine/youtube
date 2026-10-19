import { ACTION_LABELS, STEP_FIELDS, STEP_HINTS, describeStep } from '../../lib/api';
import type { ActionName, Step } from '../../lib/types';

interface Props {
  step: Step;
  index: number;
  count: number;
  picked: boolean;
  onPick: () => void;
  onPatch: (patch: Partial<Step>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}

const actions = Object.keys(STEP_FIELDS) as ActionName[];
const kinds = { css: 'CSS', text: 'Текст', label: 'Label', role: 'Роль', placeholder: 'Placeholder', xpath: 'XPath' };
const placeholders: Partial<Record<ActionName, string>> = { press: 'Enter', scroll: '600', navigate: 'https://…', type: '{{username}}' };

export function StepEditor({ step, index, count, picked, onPick, onPatch, onMove, onRemove }: Props) {
  const fields = STEP_FIELDS[step.action] || ['kind', 'query', 'value', 'x', 'y', 'end_x', 'end_y'];
  const has = (field: string) => fields.includes(field);
  const numberField = (field: 'x' | 'y' | 'end_x' | 'end_y', label: string) => has(field) && <div>
    <label>{label}</label>
    <input type="number" min={0} max={1} step={0.01} value={step[field] ?? 0}
      onChange={event => onPatch({ [field]: Number(event.target.value) })} />
  </div>;

  return <details className="step">
    <summary className="step-head">
      <input type="checkbox" className="step-pick" checked={picked} onClick={event => event.stopPropagation()}
        onChange={onPick} aria-label={`Выбрать шаг ${index + 1}`} />
      <strong>Шаг {index + 1}</strong><span className="step-summary">{describeStep(step)}</span>
      <div className="row" onClick={event => event.stopPropagation()}>
        <button type="button" className="btn tiny" title="Вверх" disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
        <button type="button" className="btn tiny" title="Вниз" disabled={index === count - 1} onClick={() => onMove(1)}>↓</button>
        <button type="button" className="btn tiny danger" title="Удалить" onClick={onRemove}>×</button>
      </div>
    </summary>
    <div className="step-grid">
      <div><label>Действие</label><select value={step.action} onChange={event => onPatch({ action: event.target.value as ActionName })}>
        {actions.map(action => <option key={action} value={action}>{ACTION_LABELS[action] || action}</option>)}
      </select></div>
      {has('kind') && <div><label>Поиск элемента</label><select value={step.kind || 'css'} onChange={event => onPatch({ kind: event.target.value as Step['kind'] })}>
        {Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></div>}
      {has('query') && <div><label>Элемент / селектор</label><input value={step.query || ''} placeholder="button, Продолжить, Email"
        onChange={event => onPatch({ query: event.target.value })} /></div>}
      {has('value') && <div><label>{step.action === 'wait' ? 'Пауза, секунды' : 'Значение / {{переменная}}'}</label>
        <input type={step.action === 'wait' ? 'number' : 'text'} min={step.action === 'wait' ? 0 : undefined}
          max={step.action === 'wait' ? 60 : undefined} step={step.action === 'wait' ? 0.1 : undefined}
          value={step.action === 'wait' ? Number(step.value || step.duration_ms || 0) / 1000 : step.value || ''}
          onChange={event => onPatch({ value: step.action === 'wait' ? String(Math.round(Number(event.target.value) * 1000)) : event.target.value })}
          placeholder={placeholders[step.action] || ''} /></div>}
      {numberField('x', 'X (0–1)')}
      {numberField('y', 'Y (0–1)')}
      {step.action === 'point' && step.scroll_state && <>
        <div><label>Прокрутка страницы, px</label><input type="number" min={0} value={step.scroll_state.y}
          onChange={event => onPatch({ scroll_state: { ...step.scroll_state!, y: Number(event.target.value) } })} /></div>
        {step.scroll_state.targets.map((target, targetIndex) => <div key={targetIndex}>
          <label>Прокрутка области {targetIndex + 1}, px</label><input type="number" min={0} value={target.top}
            onChange={event => onPatch({ scroll_state: { ...step.scroll_state!, targets: step.scroll_state!.targets.map((item, i) => i === targetIndex ? { ...item, top: Number(event.target.value) } : item) } })} />
        </div>)}
      </>}
      {numberField('end_x', 'Конец X (0–1)')}
      {numberField('end_y', 'Конец Y (0–1)')}
      <div className="wide hint">{STEP_HINTS[step.action] || 'Укажи способ поиска и элемент.'}</div>
    </div>
  </details>;
}
