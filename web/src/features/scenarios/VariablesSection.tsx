import { useMemo } from 'react';
import { variablesOf } from '@/lib/steps';
import type { Step } from '@/lib/types';

interface Props {
  steps: Step[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}

/** Значения {{переменных}} из шагов. Пароль не хранится: поле всегда пустое. */
export function VariablesSection({ steps, values, onChange }: Props) {
  const names = useMemo(() => variablesOf(steps), [steps]);

  return (
    <section className="scn-section">
      <h3>Переменные</h3>
      <p className="hint">В значении шага используй {'{{имя}}'}; пароли не хранятся, вводи их вручную.</p>
      <div className="scn-vars">
        {names.map(name => {
          const secret = name === 'password';
          return (
            <div key={name}>
              <label>{`{{${name}}}`}</label>
              <input
                type={secret ? 'password' : 'text'}
                value={secret ? '' : values[name] || ''}
                autoComplete="off"
                onChange={e => !secret && onChange({ ...values, [name]: e.target.value })}
              />
            </div>
          );
        })}
        {!names.length && <p className="hint">Переменных нет.</p>}
      </div>
    </section>
  );
}
