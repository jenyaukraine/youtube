import { clockNow, hostOf, stepsCount } from './text';
import type { Kind, Step } from './types';
import { ACTION_LABELS, KIND_LABELS } from './stepCatalog';

export * from './stepCatalog';

const pct = (v: unknown) => `${Math.round((Number(v) || 0) * 100)}%`;
const SECRET = /{{\s*password\s*}}/;

/** Короткое описание шага для списков, подсказок и прогресса. */
export function describeStep(step?: Step | null): string {
  if (!step) return '';
  const label = ACTION_LABELS[step.action] || step.action;
  if (step.name && ['click', 'point', 'fill', 'hover'].includes(step.action)) return `${label}: ${step.name}`;

  const target = step.query
    ? `${KIND_LABELS[step.kind as Kind] || step.kind || ''} «${String(step.query).slice(0, 40)}»`
    : '';
  const value = step.value == null ? '' : String(step.value);
  const quoted = SECRET.test(value)
    ? '••••••'
    : value.length > 28
      ? `«${value.slice(0, 28)}…»`
      : `«${value}»`;

  switch (step.action) {
    case 'wait':
      return `Пауза ${((Number(step.duration_ms || value) || 0) / 1000).toFixed(1)} с`;
    case 'point':
      return `Клик по точке ${pct(step.x)}, ${pct(step.y)}`;
    case 'move':
      return `Курсор к ${pct(step.x)}, ${pct(step.y)}`;
    case 'mouse_drag':
      return `Выделение мышью ${pct(step.x)}, ${pct(step.y)} → ${pct(step.end_x)}, ${pct(step.end_y)}`;
    case 'click':
      return `Клик: ${target || 'элемент'}`;
    case 'scroll': {
      const px = Number(value || 500);
      return target
        ? `Прокрутить к ${target}`
        : `Прокрутка ${px < 0 ? 'вверх' : 'вниз'} на ${Math.abs(px)} px`;
    }
    case 'type':
      return value ? `Ввод текста ${quoted}` : 'Ввод текста';
    case 'fill':
      return `Заполнить ${target} → ${value ? quoted : '…'}`;
    case 'select':
      return `Выбрать ${quoted} в ${target}`;
    case 'press':
      return `Клавиша ${value || '?'}`;
    case 'navigate':
      return `Открыть ${value.replace(/^https?:\/\//, '').slice(0, 48)}`;
    case 'wait_url':
      return `Ждать URL ${quoted}`;
    case 'screenshot':
      return `Скриншот${step.name ? ` «${step.name}»` : ''}`;
    case 'attribute':
      return `Атрибут ${value} у ${target}`;
    case 'drag':
      return `Перетащить ${target} → ${quoted}`;
    case 'exists':
    case 'count':
      return `Проверить ${target}`;
    case 'reload':
    case 'back':
    case 'page_text':
    case 'inspect':
      return label;
    default:
      return `${label}${target ? ` ${target}` : ''}${value ? ` ${quoted}` : ''}`;
  }
}

// ---------- переменные {{имя}} ----------
const VARIABLE = /{{\s*([a-zA-Z][\w]*)\s*}}/g;

export function variablesOf(steps: Step[]): string[] {
  const found = new Set<string>();
  for (const step of steps) for (const m of String(step.value || '').matchAll(VARIABLE)) found.add(m[1]);
  return [...found];
}

const HAS_VARIABLE = /{{\s*[a-zA-Z][\w]*\s*}}/;
export const hasVariables = (steps: Step[]) =>
  steps.some(s => HAS_VARIABLE.test(s.value || '') || HAS_VARIABLE.test(s.query || ''));

/** Подставляет переменные; неизвестные оставляет как есть, пароль не хранится и не подставляется. */
export function substituteVariables(steps: Step[], variables: Record<string, string> = {}): Step[] {
  const fill = (text?: string) =>
    text == null
      ? text
      : text.replace(VARIABLE, (whole, name) => (name in variables ? variables[name] : whole));
  return steps.map(step => ({ ...step, query: fill(step.query), value: fill(step.value) }));
}

/** Оставляет только поля схемы сервера (без duration_ms и прочего мусора из snapshot). */
export function serverStep(step: Step): Step {
  const {
    action,
    kind,
    query,
    role,
    value,
    replace,
    x,
    y,
    end_x,
    end_y,
    nth,
    timeout_ms,
    optional,
    name,
    scroll_state,
  } = step;
  return {
    action,
    kind,
    query,
    role,
    value,
    replace,
    x,
    y,
    end_x,
    end_y,
    nth,
    timeout_ms,
    optional,
    name,
    scroll_state,
  };
}

/** Шаги из snapshot сервера: пауза приходит как duration_ms, редактор ждёт value. */
export const normalizeSteps = (steps: Step[]) =>
  steps.map(s => ({
    ...s,
    value: s.action === 'wait' && !s.value && s.duration_ms ? String(s.duration_ms) : s.value || '',
  }));

/** Вставляет паузу между действиями, если прошло ≥ 350 мс (кратно 100 мс, не больше минуты). */
export function waitStepsFor(gapMs: number): Step[] {
  const steps: Step[] = [];
  let gap = Math.max(0, gapMs);
  while (gap >= 350) {
    const part = Math.min(60000, Math.round(gap / 100) * 100);
    steps.push({ action: 'wait', value: String(part) });
    gap -= part;
  }
  return steps;
}

export const newScenarioName = (startUrl: string, count: number) =>
  `${hostOf(startUrl) || 'Сценарий'} · ${stepsCount(count)} · ${clockNow()}`;
