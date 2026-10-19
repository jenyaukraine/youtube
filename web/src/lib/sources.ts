import { type Draft } from './storage';
import { stepsCount } from './text';
import type { Macro, Scenario, StepSource } from './types';

// Откуда берутся шаги для запуска: значения вида «scenario:<id>», «macro:<name>», «draft:<key>».

export interface SourceOption {
  value: string;
  label: string;
}

export const scenarioValue = (s: Scenario) => `scenario:${s.id}`;
export const macroValue = (m: Macro) => `macro:${m.name}`;

/** Сколько записей в библиотеке: локальные сценарии плюс макросы, которых нет среди них. */
export const libraryCount = (scenarios: Scenario[], macros: Macro[]) =>
  scenarios.length + macros.filter(m => !scenarios.some(s => s.name === m.name)).length;

/** Сценарии и макросы одним списком; макросы с тем же именем, что у сценария, скрыты. */
export function sourceOptions(scenarios: Scenario[], macros: Macro[], drafts: Draft[] = []): SourceOption[] {
  const names = new Set(scenarios.map(s => s.name));
  return [
    ...scenarios
      .filter(s => s.steps.length)
      .map(s => ({ value: scenarioValue(s), label: `${s.name} · ${stepsCount(s.steps.length)}` })),
    ...drafts
      .filter(d => d.steps.length)
      .map(d => ({ value: `draft:${d.key}`, label: `Черновик: ${d.startUrl || d.key}` })),
    ...macros
      .filter(m => !names.has(m.name))
      .map(m => ({ value: macroValue(m), label: `${m.name} · сервер` })),
  ];
}

export function findSource(
  value: string,
  scenarios: Scenario[],
  macros: Macro[],
  drafts: Draft[] = [],
): StepSource | null {
  const [type, key] = [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)];
  if (type === 'scenario') return scenarios.find(s => s.id === key) || null;
  if (type === 'draft') return drafts.find(d => d.key === key) || null;
  if (type === 'macro') {
    const macro = macros.find(m => m.name === key);
    return macro ? { steps: macro.steps, startUrl: macro.start_url, settings: macro.settings } : null;
  }
  return null;
}
