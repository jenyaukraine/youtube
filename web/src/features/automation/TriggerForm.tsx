import { useState, type FormEvent } from 'react';
import { saveTrigger } from '@/api/automation';
import { cx } from '@/lib/cx';
import { toast, toastResult } from '@/lib/toast';
import { EMPTY_TRIGGER_FORM, buildTrigger, type TriggerForm as FormState } from './buildTrigger';
import type { TestNote, TriggerTester } from './useTriggerTest';

interface Props {
  note: TestNote | null;
  onTest: TriggerTester;
}

const KINDS = [
  ['text', 'Виден текст'],
  ['css', 'Виден CSS'],
  ['role:button', 'Видна кнопка'],
  ['role:link', 'Видна ссылка'],
  ['label', 'Виден label'],
  ['url', 'URL совпадает (regex)'],
];

const REACTIONS = [
  ['click', 'Кликнуть по найденному элементу'],
  ['press:Escape', 'Нажать Escape'],
  ['reload', 'Перезагрузить страницу'],
  ['screenshot', 'Сделать скриншот в файлы'],
  ['steps', 'Свои шаги (JSON ниже)'],
];

/** Форма нового триггера с проверкой на активной вкладке до сохранения. */
export function TriggerForm({ note, onTest }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY_TRIGGER_FORM);
  const patch = (next: Partial<FormState>) => setForm(f => ({ ...f, ...next }));

  const built = () => {
    const result = buildTrigger(form);
    if (typeof result !== 'string') return result;
    toast(result, 'err');
    return null;
  };

  const check = (run: boolean) => {
    const t = built();
    if (t) void onTest(t.when, t.then, run);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = built();
    if (!t) return;
    const name = form.name.trim() || form.query.trim().slice(0, 30);
    const r = await saveTrigger({ name, when: t.when, then: t.then, cooldown_ms: 5000 });
    toastResult(r, 'Триггер добавлен', 'Не удалось добавить');
    if (r.ok) patch({ name: '', query: '' });
  };

  return (
    <form className="auto-form" onSubmit={submit}>
      <input
        type="text"
        className="auto-wide"
        value={form.name}
        onChange={e => patch({ name: e.target.value })}
        placeholder="Название"
        aria-label="Название"
        maxLength={80}
      />
      <select value={form.kind} onChange={e => patch({ kind: e.target.value })} aria-label="Условие">
        {KINDS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={form.query}
        onChange={e => patch({ query: e.target.value })}
        placeholder="Что искать"
        aria-label="Что искать"
        maxLength={300}
      />
      <select
        className="auto-wide"
        value={form.then}
        onChange={e => patch({ then: e.target.value })}
        aria-label="Реакция"
      >
        {REACTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {form.then === 'steps' && (
        <textarea
          className="auto-wide"
          value={form.steps}
          onChange={e => patch({ steps: e.target.value })}
          placeholder='[{"action":"click","kind":"text","query":"Принять все"}]'
          aria-label="Шаги JSON"
        />
      )}
      <div className="auto-wide trigger-test-row">
        <button type="button" className="btn" onClick={() => check(false)}>
          Проверить на вкладке
        </button>
        <button type="button" className="btn" onClick={() => check(true)}>
          Выполнить сейчас
        </button>
      </div>
      {note && <div className={cx('auto-wide note', note.ok ? 'ok' : 'err')}>{note.text}</div>}
      <button type="submit" className="btn btn-accent auto-wide">
        Добавить триггер
      </button>
    </form>
  );
}
