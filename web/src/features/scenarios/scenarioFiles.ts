import { localScenarios, saveLocalScenarios } from '@/lib/storage';
import type { Scenario } from '@/lib/types';

/** Скачивает все локальные сценарии одним JSON-файлом. */
export function exportScenarios(scenarios: Scenario[]) {
  const blob = new Blob([JSON.stringify(scenarios, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'katya-scenarios.json';
  link.click();
  URL.revokeObjectURL(url);
}

const normalize = (raw: Partial<Scenario>): Scenario => ({
  id: raw.id || crypto.randomUUID(),
  name: raw.name || 'Сценарий',
  startUrl: raw.startUrl || 'https://',
  steps: raw.steps || [],
  settings: raw.settings,
  variables: raw.variables,
  createdAt: raw.createdAt || new Date().toISOString(),
});

const looksLikeScenario = (raw: unknown): raw is Partial<Scenario> =>
  typeof raw === 'object' && raw !== null && Array.isArray((raw as Partial<Scenario>).steps);

/** Читает JSON (объект или массив), добавляет сценарии в начало списка; бросает при плохом файле. */
export async function importScenarios(file: File): Promise<number> {
  const data: unknown = JSON.parse(await file.text());
  const list = Array.isArray(data) ? data : [data];
  const imported = list.filter(looksLikeScenario).map(normalize);
  saveLocalScenarios([...imported, ...localScenarios()]);
  return imported.length;
}
