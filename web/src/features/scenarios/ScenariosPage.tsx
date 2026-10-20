import { useState } from 'react';
import type { Library } from '@/hooks/useLibrary';
import { addLocalScenario, saveLocalScenarios } from '@/lib/storage';
import { toast } from '@/lib/toast';
import type { Macro, Scenario } from '@/lib/types';
import { ScenarioEditor } from './ScenarioEditor';
import { ScenarioList } from './ScenarioList';
import './scenarios.css';

const MAX_SCENARIOS = 50;

/** Страница «Сценарии»: список слева, редактор шагов и переменных справа. */
export function ScenariosPage({ library }: { library: Library }) {
  const { scenarios, macros, refresh } = library;
  const [selected, setSelected] = useState<string | null>(scenarios[0]?.id ?? null);
  const current = scenarios.find(s => s.id === selected) ?? null;

  const save = (next: Scenario) => {
    saveLocalScenarios(scenarios.map(s => (s.id === next.id ? next : s)));
    refresh();
  };

  const full = () => {
    if (scenarios.length < MAX_SCENARIOS) return false;
    toast(`Лимит: ${MAX_SCENARIOS} сценариев`, 'err');
    return true;
  };

  const create = () => {
    if (full()) return;
    const created = addLocalScenario({ name: 'Новый сценарий', startUrl: 'https://', steps: [] });
    refresh();
    setSelected(created.id);
  };

  // Серверный макрос открывается как копия: правки не трогают оригинал.
  const copyMacro = (macro: Macro) => {
    if (full()) return;
    const created = addLocalScenario({
      name: macro.name,
      startUrl: macro.start_url || 'https://',
      steps: structuredClone(macro.steps),
      settings: macro.settings,
    });
    refresh();
    setSelected(created.id);
  };

  const remove = () => {
    if (!current || !confirm(`Удалить «${current.name}»?`)) return;
    saveLocalScenarios(scenarios.filter(s => s.id !== current.id));
    refresh();
    setSelected(null);
  };

  return (
    <div className="scn-layout">
      <ScenarioList
        scenarios={scenarios}
        macros={macros}
        selected={selected}
        onSelect={setSelected}
        onCreate={create}
        onCopyMacro={copyMacro}
        onChanged={refresh}
      />
      <main className="panel scn-editor">
        {current ? (
          <ScenarioEditor key={current.id} scenario={current} onChange={save} onRemove={remove} />
        ) : (
          <div className="empty">Выбери сценарий слева или создай новый.</div>
        )}
      </main>
    </div>
  );
}
