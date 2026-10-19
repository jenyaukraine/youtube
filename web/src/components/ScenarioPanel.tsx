import { useEffect, useRef, useState } from 'react';
import { describeStep, plural } from '../lib/api';
import type { ActionName, Kind, ScenarioStatus, Step } from '../lib/types';
import { StepList } from './StepList';

export interface LoadOption { label: string; value: string }
export interface ClientRun { index: number; total: number }

interface Props {
  // сценарий, с которым открыли вкладку (сервер), и его состояние
  scenarioSteps: Step[];
  status: ScenarioStatus;
  clientRun: ClientRun | null;
  chipPicked: number | null;
  onChipPick: (index: number) => void;
  onRunFrom: () => void;
  onClearPick: () => void;
  // рекордер
  steps: Step[];
  from: number;
  picked: Set<number>;
  recording: boolean;
  replaying: boolean;
  repeat: number;
  setRepeat: (n: number) => void;
  statusText: string;
  onToggleRecord: () => void;
  onReplay: () => void;
  onSave: () => void;
  onLoad: (choice: string) => void;
  loadOptions: LoadOption[];
  onPickStart: (i: number) => void;
  onToggle: (i: number, shift: boolean) => void;
  onDelete: () => void;
  onUnpick: () => void;
  onCopy: () => void;
  onClear: () => void;
  onManual: (step: Step) => void;
}

const MANUAL_ACTIONS: { v: ActionName; t: string }[] = [
  { v: 'click', t: 'Кликнуть' }, { v: 'wait_click', t: 'Ждать и кликнуть' }, { v: 'fill', t: 'Ввести текст' }, { v: 'hover', t: 'Навести мышь' },
  { v: 'drag', t: 'Перетащить' }, { v: 'scroll', t: 'Прокрутить' }, { v: 'press', t: 'Нажать клавишу' }, { v: 'navigate', t: 'Открыть URL' },
  { v: 'dblclick', t: 'Двойной клик' }, { v: 'type', t: 'Печатать по буквам' }, { v: 'select', t: 'Выбрать в списке' }, { v: 'wait_for', t: 'Ждать появления' },
  { v: 'wait_gone', t: 'Ждать исчезновения' }, { v: 'wait', t: 'Пауза (мс)' }, { v: 'text', t: 'Прочитать текст' }, { v: 'screenshot', t: 'Скриншот в файлы' }, { v: 'reload', t: 'Перезагрузить' },
];
const NEEDS_ELEMENT = new Set(['click', 'wait_click', 'dblclick', 'fill', 'type', 'hover', 'drag', 'select', 'wait_for', 'wait_gone', 'text']);
const NEEDS_VALUE = new Set(['fill', 'type', 'drag', 'scroll', 'press', 'navigate', 'select', 'wait', 'screenshot']);

/** Универсальная панель «Сценарий»: прогресс, выбор шага, запись, повтор, сохранение, ручное действие. Одна для всех экранов. */
export function ScenarioPanel(p: Props) {
  const stepsRef = useRef<HTMLOListElement>(null);
  const total = p.scenarioSteps.length;
  const running = p.clientRun ? true : p.status.phase === 'running';
  const cur = p.clientRun ? p.clientRun.index : (p.status.current || 0);
  const completed = p.clientRun ? p.clientRun.index : (p.status.completed || 0);
  const done = !p.clientRun && p.status.phase === 'done';
  const error = !p.clientRun && p.status.phase === 'error';
  const label = (i: number) => describeStep(p.clientRun ? p.steps[i] : p.scenarioSteps[i]);

  useEffect(() => {
    if (!running) return;
    stepsRef.current?.querySelector('li.current')?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [running, cur]);

  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (p.status.phase !== 'waiting') return;
    const t = window.setInterval(() => setWait(Math.max(0, Math.ceil((p.status.wait_until || 0) - Date.now() / 1000))), 300);
    return () => window.clearInterval(t);
  }, [p.status.phase, p.status.wait_until]);

  let nowK = '', nowT = '';
  if (running) { nowK = `Шаг ${cur + 1} из ${total}`; nowT = label(cur); }
  else if (error) { nowK = `Ошибка на шаге ${cur + 1}`; nowT = label(cur); }
  else if (done) { nowK = 'Сценарий выполнен'; nowT = `${total} ${plural(total, 'шаг', 'шага', 'шагов')}`; }
  else if (p.status.phase === 'waiting') { nowK = 'Ожидание'; nowT = wait ? `старт через ${wait} с · первый шаг: ${label(0)}` : `первый шаг: ${label(0)}`; }
  else if (total) { nowK = 'Открывается страница'; nowT = label(0); }

  const statusLine = p.clientRun ? `Повтор из записи · ${p.clientRun.index}/${p.clientRun.total}`
    : done ? `Готово · ${total}/${total}` : error ? `Остановлен · ${completed}/${total}` : running ? `Выполняется · ${completed}/${total}` : '';

  const showBar = total > 0 && !running && (p.chipPicked != null || done);
  const barText = p.chipPicked != null ? `Шаг ${p.chipPicked + 1} из ${total} · ${describeStep(p.scenarioSteps[p.chipPicked])}` : 'Повторить весь сценарий в этой вкладке';

  // ручное действие
  const [mAction, setMAction] = useState<ActionName>('click');
  const [mKind, setMKind] = useState('css');
  const [mQuery, setMQuery] = useState('');
  const [mValue, setMValue] = useState('');
  const submitManual = () => {
    const kind = (mKind.startsWith('role:') ? 'role' : mKind) as Kind;
    p.onManual({ action: mAction, kind, role: mKind.startsWith('role:') ? mKind.slice(5) : 'button', query: mQuery, value: mValue });
  };

  return (
    <section className="scenario-panel worker-control">
      <div className="scenario-progress-head"><strong>Сценарий</strong><span className="scenario-progress-status">{statusLine}</span></div>
      {total > 0 && (
        <div className={['scenario-progress', done ? 'done' : '', error ? 'error' : ''].join(' ').trim()}>
          <div className="scenario-now"><span className="scenario-now-k">{nowK}</span><span className="scenario-now-t">{nowT}</span></div>
          {showBar && (
            <div className="scenario-action" data-mode={p.chipPicked == null ? 'done' : undefined}>
              <span className="scenario-action-t">{barText}</span>
              <button type="button" className="scenario-run" onClick={p.onRunFrom}>{p.chipPicked == null ? '▶ Повторить' : '▶ Запустить отсюда'}</button>
              {p.chipPicked != null && <button type="button" className="scenario-action-x" onClick={p.onClearPick} aria-label="Снять выбор">✕</button>}
            </div>
          )}
          <div className="scenario-track"><i style={{ width: `${Math.min(100, completed / total * 100)}%` }} /></div>
          <ol className="scenario-steps" ref={stepsRef} aria-label="Шаги сценария">
            {p.scenarioSteps.map((s, i) => (
              <li key={i} title={`${i + 1}. ${describeStep(s)} — нажми, чтобы повторять с этого шага`}
                  className={[i < completed ? 'done' : '', running && i === cur ? 'current' : '', error && i === cur ? 'failed' : '', p.chipPicked === i ? 'picked' : ''].join(' ').trim()}
                  onClick={() => !running && p.onChipPick(i)}>
                <b>{i + 1}</b><span>{describeStep(s)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="recorder">
        <button type="button" className={'record-toggle' + (p.recording ? ' recording' : '')} onClick={p.onToggleRecord}>{p.recording ? '■ Остановить запись' : '● Записать шаги'}</button>
        <div className="repeat-control">
          <input type="number" className="repeat-count" min={1} max={100} value={p.repeat} onChange={e => p.setRepeat(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} aria-label="Сколько раз повторить" disabled={p.replaying} />
          <span>раз</span>
          <button type="button" className={'record-replay' + (p.replaying ? ' running' : '')} onClick={p.onReplay}>
            {p.replaying ? '■ Остановить' : p.from > 0 ? `▶ С шага ${p.from + 1}` : '▶ Повторить'}
          </button>
        </div>
        <button type="button" className="record-save" onClick={p.onSave}>💾 Сохранить</button>
        <select className="macro-pick" aria-label="Открыть сценарий" value="" onChange={e => { if (e.target.value) p.onLoad(e.target.value); }}>
          <option value="">Открыть сценарий…</option>
          {p.loadOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <details className="recorder-more">
          <summary title="Ещё">⋯</summary>
          <div className="recorder-menu">
            <button type="button" onClick={p.onCopy}>Копировать шаги как JSON</button>
            <button type="button" onClick={p.onUnpick}>Повторять с начала</button>
          </div>
        </details>
        <button type="button" className="record-clear icon" title="Очистить запись" aria-label="Очистить запись" onClick={p.onClear}>🗑</button>
      </div>
      <div className="record-status" aria-live="polite">{p.statusText}</div>
      <StepList steps={p.steps} from={p.from} picked={p.picked} onPickStart={p.onPickStart} onToggle={p.onToggle} onDelete={p.onDelete} onUnpick={p.onUnpick} />

      <details className="manual-action">
        <summary>Ручное действие по селектору · для точной настройки</summary>
        <div className="control-grid">
          <select className="action-type" value={mAction} onChange={e => setMAction(e.target.value as ActionName)} aria-label="Действие">
            {MANUAL_ACTIONS.map(a => <option key={a.v} value={a.v}>{a.t}</option>)}
          </select>
          {NEEDS_ELEMENT.has(mAction) && (
            <select className="action-kind" value={mKind} onChange={e => setMKind(e.target.value)} aria-label="Найти элемент">
              <option value="css">CSS selector</option><option value="text">Текст</option><option value="label">Label</option>
              <option value="role:button">Роль: кнопка</option><option value="role:link">Роль: ссылка</option><option value="role:textbox">Роль: поле ввода</option>
              <option value="role:checkbox">Роль: checkbox</option><option value="placeholder">Placeholder</option><option value="xpath">XPath</option>
            </select>
          )}
          {NEEDS_ELEMENT.has(mAction) && <input className="action-query" value={mQuery} onChange={e => setMQuery(e.target.value)} placeholder="Элемент: CSS, текст, роль или label" aria-label="Элемент" />}
          {NEEDS_VALUE.has(mAction) && <input className="action-value" value={mValue} onChange={e => setMValue(e.target.value)} placeholder={({ fill: 'Текст для ввода', drag: 'Цель перетаскивания', scroll: 'Пикселей, например 500', press: 'Клавиша: Enter, Escape', navigate: 'https://example.com', type: 'Текст по буквам', select: 'Значение option', wait: 'Миллисекунды', screenshot: 'Имя файла или full' } as Record<string, string>)[mAction] || 'Значение'} aria-label="Значение" />}
        </div>
        <div className="control-help">Действие выполняется только в этой вкладке и записывается, если идёт запись.</div>
        <button type="button" className="worker-action-run" onClick={submitManual}>Выполнить действие</button>
      </details>
    </section>
  );
}
