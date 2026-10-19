import { useState } from 'react';
import { deleteMacro, saveLocalScenarios, startTabs, toast } from '../lib/api';
import type { Macro, Scenario, Step } from '../lib/types';
import { ScenarioEditor } from './scenarios/ScenarioEditor';
import { ScenarioSidebar } from './scenarios/ScenarioSidebar';

interface Props {
  scenarios: Scenario[];
  macros: Macro[];
  onChanged: () => void;
  onMacrosChanged: () => void;
  onStarted: () => void;
}

const variablePattern = /{{\s*([a-zA-Z]\w*)\s*}}/g;

export function ScenariosPage({ scenarios, macros, onChanged, onMacrosChanged, onStarted }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(scenarios[0]?.id ?? null);
  const [password, setPassword] = useState('');
  const selected = scenarios.find(scenario => scenario.id === selectedId) ?? null;

  function save(scenario: Scenario) {
    saveLocalScenarios(scenarios.map(item => item.id === scenario.id ? scenario : item));
    onChanged();
  }

  function add(scenario: Scenario) {
    if (scenarios.length >= 50) return toast('Лимит: 50 сценариев', 'err');
    saveLocalScenarios([scenario, ...scenarios]);
    onChanged();
    setSelectedId(scenario.id);
    setPassword('');
  }

  function create() {
    add({ id: crypto.randomUUID(), name: 'Новый сценарий', startUrl: 'https://', steps: [], createdAt: new Date().toISOString() });
  }

  function copyMacro(macro: Macro) {
    add({ id: crypto.randomUUID(), name: macro.name, startUrl: macro.start_url || 'https://', steps: structuredClone(macro.steps), settings: macro.settings, createdAt: new Date().toISOString() });
  }

  function remove() {
    if (!selected || !confirm(`Удалить «${selected.name}»?`)) return;
    saveLocalScenarios(scenarios.filter(item => item.id !== selected.id));
    onChanged();
    setSelectedId(null);
    setPassword('');
  }

  async function removeMacro(macro: Macro) {
    if (!confirm(`Удалить «${macro.name}»?`)) return;
    const result = await deleteMacro(macro.name);
    toast(result.ok ? 'Удалено' : result.error || 'Ошибка', result.ok ? 'ok' : 'err');
    if (result.ok) onMacrosChanged();
  }

  async function run() {
    if (!selected) return;
    if (!/^https?:\/\//.test(selected.startUrl)) return toast('Укажи стартовую страницу', 'err');
    const variables: Record<string, string> = { ...selected.variables, password };
    const resolve = (value: string) => value.replace(variablePattern, (match, name: string) => variables[name] || match);
    const steps: Step[] = selected.steps.map(step => ({ ...step, query: resolve(step.query || ''), value: resolve(step.value || '') }));
    if (steps.some(step => /{{\s*[a-zA-Z]\w*\s*}}/.test(`${step.query} ${step.value}`))) return toast('Заполни переменные перед запуском', 'err');
    const result = await startTabs({ url: selected.startUrl, workers: 1, duration: 0, headers: selected.settings?.headers || {}, user_agent_mode: selected.settings?.user_agent_mode || 'chrome', steps });
    if (!result.ok) return toast(result.error || 'Ошибка запуска', 'err');
    toast('Вкладка открыта, сценарий запущен');
    onStarted();
  }

  return (
    <div className="layout">
      <ScenarioSidebar scenarios={scenarios} macros={macros} selectedId={selectedId}
        onSelect={id => { setSelectedId(id); setPassword(''); }} onCreate={create}
        onCopyMacro={copyMacro} onRemoveMacro={removeMacro} onChanged={onChanged} />
      <main className="panel">
        {selected ? (
          <ScenarioEditor key={selected.id} scenario={selected} password={password} onPasswordChange={setPassword}
            onSave={save} onRun={run} onRemove={remove} />
        ) : <div className="empty">Выбери сценарий слева или создай новый.</div>}
      </main>
    </div>
  );
}
