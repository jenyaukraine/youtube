import { useState } from 'react';
import { startTabs } from '@/api/tabs';
import { hasVariables, substituteVariables } from '@/lib/steps';
import { isHttpUrl } from '@/lib/text';
import { toast, toastResult } from '@/lib/toast';
import type { Scenario, Step } from '@/lib/types';
import { StepsSection } from './StepsSection';
import { VariablesSection } from './VariablesSection';

interface Props {
  scenario: Scenario;
  onChange: (next: Scenario) => void;
  onRemove: () => void;
}

/** Редактор одного сценария: название, стартовая страница, шаги, переменные, запуск во вкладке. */
export function ScenarioEditor({ scenario, onChange, onRemove }: Props) {
  // Пароль живёт только до перезагрузки и никогда не сохраняется в сценарий.
  const [password, setPassword] = useState('');
  const nameId = `scn-name-${scenario.id}`;
  const urlId = `scn-url-${scenario.id}`;

  const changeSteps = (steps: Step[]) => onChange({ ...scenario, steps });
  const changeVariables = (variables: Record<string, string>) => onChange({ ...scenario, variables });

  const run = async () => {
    if (!isHttpUrl(scenario.startUrl)) {
      toast('Укажи стартовую страницу', 'err');
      return;
    }
    const steps = substituteVariables(scenario.steps, { ...scenario.variables, password });
    if (hasVariables(steps)) {
      toast('Заполни переменные перед запуском', 'err');
      return;
    }
    const r = await startTabs({
      url: scenario.startUrl,
      workers: 1,
      duration: 0,
      headers: scenario.settings?.headers || {},
      user_agent_mode: scenario.settings?.user_agent_mode || 'chrome',
      steps,
    });
    toastResult(r, 'Вкладка открыта, сценарий запущен', 'Ошибка запуска');
  };

  return (
    <>
      <div className="scn-head">
        <h2>Редактор сценария</h2>
        <div className="btn-row">
          <button type="button" className="btn btn-primary" onClick={run}>
            ▶ Запустить во вкладке
          </button>
          <button type="button" className="btn btn-danger" onClick={onRemove}>
            Удалить
          </button>
        </div>
      </div>
      <div className="scn-cols">
        <div>
          <label htmlFor={nameId}>Название</label>
          <input
            id={nameId}
            value={scenario.name}
            maxLength={80}
            onChange={e => onChange({ ...scenario, name: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor={urlId}>Стартовая страница</label>
          <input
            id={urlId}
            value={scenario.startUrl}
            onChange={e => onChange({ ...scenario, startUrl: e.target.value.trim() })}
          />
        </div>
      </div>
      <StepsSection steps={scenario.steps} onChange={changeSteps} />
      <VariablesSection
        steps={scenario.steps}
        values={scenario.variables || {}}
        password={password}
        onChange={changeVariables}
        onPassword={setPassword}
      />
    </>
  );
}
