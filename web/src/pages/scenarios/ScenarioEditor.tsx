import { useMemo, useState } from 'react';
import type { Scenario, Step } from '../../lib/types';
import { StepEditor } from './StepEditor';

interface Props {
  scenario: Scenario;
  password: string;
  onPasswordChange: (value: string) => void;
  onSave: (scenario: Scenario) => void;
  onRun: () => void;
  onRemove: () => void;
}

export function ScenarioEditor({ scenario, password, onPasswordChange, onSave, onRun, onRemove }: Props) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const variables = useMemo(() => {
    const names = new Set<string>();
    for (const step of scenario.steps) {
      for (const field of [step.query, step.value]) {
        for (const match of (field || '').matchAll(/{{\s*([a-zA-Z]\w*)\s*}}/g)) names.add(match[1]);
      }
    }
    return [...names];
  }, [scenario.steps]);

  const saveSteps = (steps: Step[]) => onSave({ ...scenario, steps });
  const patchStep = (index: number, patch: Partial<Step>) => saveSteps(scenario.steps.map((step, i) => i === index ? { ...step, ...patch } : step));
  const togglePicked = (index: number) => setPicked(current => {
    const next = new Set(current);
    if (next.has(index)) next.delete(index); else next.add(index);
    return next;
  });
  const removeSteps = (indices: Set<number>) => {
    saveSteps(scenario.steps.filter((_, index) => !indices.has(index)));
    setPicked(new Set());
  };
  const moveStep = (index: number, direction: -1 | 1) => {
    const steps = [...scenario.steps];
    [steps[index], steps[index + direction]] = [steps[index + direction], steps[index]];
    saveSteps(steps);
    setPicked(new Set());
  };

  return <>
    <div className="row scenario-editor-heading">
      <h2>Редактор сценария</h2>
      <div className="row">
        <button className="btn primary" onClick={onRun}>▶ Запустить во вкладке</button>
        <button className="btn danger" onClick={onRemove}>Удалить</button>
      </div>
    </div>
    <div className="cols">
      <div><label>Название</label><input value={scenario.name} maxLength={80} onChange={event => onSave({ ...scenario, name: event.target.value })} /></div>
      <div><label>Стартовая страница</label><input value={scenario.startUrl} onChange={event => onSave({ ...scenario, startUrl: event.target.value })} /></div>
    </div>
    <section className="section">
      <div className="row scenario-section-heading">
        <div><h3>Шаги</h3><div className="hint">Поля зависят от действия. Отметь шаги для удаления списком.</div></div>
        <button className="btn" onClick={() => saveSteps([...scenario.steps, { action: 'click', kind: 'css', query: '', value: '' }])}>+ Шаг</button>
      </div>
      {picked.size > 0 && <div className="row steps-bulk">
        <span>Выбрано: {picked.size} из {scenario.steps.length}</span>
        <button type="button" className="btn tiny danger" onClick={() => removeSteps(picked)}>Удалить выбранные</button>
        <button type="button" className="btn tiny" onClick={() => setPicked(new Set())}>Снять выбор</button>
      </div>}
      <div className="step-list">
        {scenario.steps.map((step, index) => <StepEditor key={index} step={step} index={index} count={scenario.steps.length}
          picked={picked.has(index)} onPick={() => togglePicked(index)} onPatch={patch => patchStep(index, patch)}
          onMove={direction => moveStep(index, direction)} onRemove={() => removeSteps(new Set([index]))} />)}
        {!scenario.steps.length && <div className="hint">Шагов пока нет. Запиши действия во вкладке или добавь шаг здесь.</div>}
      </div>
    </section>
    <section className="section">
      <h3>Переменные</h3>
      <div className="hint">В значении шага или селекторе используй {'{{имя}}'}; пароль хранится только до закрытия редактора.</div>
      <div className="variable-grid">
        {variables.map(name => <div key={name}>
          <label>{`{{${name}}}`}</label>
          <input type={name === 'password' ? 'password' : 'text'} value={name === 'password' ? password : scenario.variables?.[name] || ''}
            onChange={event => name === 'password' ? onPasswordChange(event.target.value) : onSave({ ...scenario, variables: { ...scenario.variables, [name]: event.target.value } })} />
        </div>)}
        {!variables.length && <div className="hint">Переменных нет.</div>}
      </div>
    </section>
  </>;
}
