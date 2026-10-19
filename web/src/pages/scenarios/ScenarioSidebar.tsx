import { useRef } from 'react';
import { ACTION_LABELS, saveLocalScenarios, toast } from '../../lib/api';
import type { Macro, Scenario, Step } from '../../lib/types';

interface Props {
  scenarios: Scenario[];
  macros: Macro[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onCopyMacro: (macro: Macro) => void;
  onRemoveMacro: (macro: Macro) => void;
  onChanged: () => void;
}

function isScenario(value: unknown): value is Scenario {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<Scenario>;
  return typeof item.name === 'string' && typeof item.startUrl === 'string'
    && Array.isArray(item.steps) && item.steps.every(isStep);
}

function isStep(value: unknown): value is Step {
  return !!value && typeof value === 'object' && typeof (value as Step).action === 'string'
    && (value as Step).action in ACTION_LABELS;
}

export function ScenarioSidebar({ scenarios, macros, selectedId, onSelect, onCreate, onCopyMacro, onRemoveMacro, onChanged }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);

  function exportJson() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(scenarios, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'katya-scenarios.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function importJson(file: File) {
    try {
      const data: unknown = JSON.parse(await file.text());
      const items = Array.isArray(data) ? data : [data];
      if (!items.length || !items.every(isScenario)) throw new Error('Неверная структура сценария');
      const available = Math.max(0, 50 - scenarios.length);
      const imported = items.slice(0, available).map(item => ({ ...item, id: crypto.randomUUID(), createdAt: item.createdAt || new Date().toISOString() }));
      if (!imported.length) return toast('Лимит: 50 сценариев', 'err');
      saveLocalScenarios([...imported, ...scenarios]);
      onChanged();
      toast(`Импортировано: ${imported.length}${imported.length < items.length ? ' (лимит 50)' : ''}`);
    } catch {
      toast('Не удалось прочитать JSON сценариев', 'err');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <aside className="panel sidebar">
      <h2>Мои сценарии</h2>
      <button className="btn primary full" onClick={onCreate}>+ Новый сценарий</button>
      <div className="scenario-list">
        {scenarios.map(scenario => (
          <button key={scenario.id} className={scenario.id === selectedId ? 'active' : ''} onClick={() => onSelect(scenario.id)}>
            <strong>{scenario.name}</strong><small>{scenario.steps.length} шагов · {scenario.startUrl}</small>
          </button>
        ))}
      </div>
      {!!macros.length && <>
        <h3>На сервере</h3>
        <div className="scenario-list">
          {macros.map(macro => <div className="scenario-library-row" key={macro.name}>
            <button type="button" className="scenario-library-open" onClick={() => onCopyMacro(macro)}>
              <strong>{macro.name}</strong><small>{macro.steps.length} шагов · открыть для изменения</small>
            </button>
            <button type="button" className="scenario-library-remove" onClick={() => onRemoveMacro(macro)}>Удалить</button>
          </div>)}
        </div>
      </>}
      <div className="row">
        <button className="btn" onClick={exportJson}>Скачать JSON</button>
        <label className="btn">Импорт JSON<input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={event => {
          const file = event.target.files?.[0];
          if (file) void importJson(file);
        }} /></label>
      </div>
      <p className="hint">Сценарии хранятся в этом браузере и как макросы на сервере. Запись — во вкладке: «● Записать шаги», затем «💾 Сохранить».</p>
    </aside>
  );
}
