import type { Step, TriggerWhen } from '@/lib/types';

export interface TriggerForm {
  name: string;
  /** text | css | role:button | role:link | label | url */
  kind: string;
  query: string;
  /** click | press:<Key> | reload | screenshot | steps */
  then: string;
  /** JSON-массив шагов для then === 'steps'. */
  steps: string;
}

export interface BuiltTrigger {
  when: TriggerWhen;
  then: Step[];
}

export const EMPTY_TRIGGER_FORM: TriggerForm = {
  name: '',
  kind: 'text',
  query: '',
  then: 'click',
  steps: '',
};

/** Собирает триггер из формы; строка — текст ошибки для пользователя. */
export function buildTrigger(form: TriggerForm): BuiltTrigger | string {
  const isRole = form.kind.startsWith('role:');
  const kind = (isRole ? 'role' : form.kind) as TriggerWhen['kind'];
  const query = form.query.trim();
  if (!query) return 'Укажи, что искать на странице';

  const when: TriggerWhen = { kind, query, role: isRole ? form.kind.slice(5) : 'button' };
  const then = buildThen(form, when);
  return typeof then === 'string' ? then : { when, then };
}

function buildThen(form: TriggerForm, when: TriggerWhen): Step[] | string {
  if (form.then === 'click') {
    if (when.kind === 'url') return 'Для условия URL выбери другое действие';
    return [{ action: 'click', kind: when.kind, role: when.role, query: when.query, optional: true }];
  }
  if (form.then.startsWith('press:')) return [{ action: 'press', value: form.then.slice(6) }];
  if (form.then === 'reload') return [{ action: 'reload' }];
  if (form.then === 'screenshot') return [{ action: 'screenshot', name: form.name.trim() }];
  return parseSteps(form.steps);
}

function parseSteps(raw: string): Step[] | string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed as Step[];
  } catch {
    /* не JSON */
  }
  return 'Шаги должны быть JSON-массивом';
}
