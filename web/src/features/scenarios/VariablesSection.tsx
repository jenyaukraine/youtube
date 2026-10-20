import { useMemo } from 'react';
import { variablesOf } from '@/lib/steps';
import type { Step } from '@/lib/types';

interface Props {
  steps: Step[];
  values: Record<string, string>;
  password: string;
  onChange: (values: Record<string, string>) => void;
  onPassword: (value: string) => void;
}

/** Значения {{переменных}} из шагов. Пароль вводится перед запуском и не сохраняется. */
export function VariablesSection({ steps, values, password, onChange, onPassword }: Props) {
  const names = useMemo(() => variablesOf(steps), [steps]);

  return (
    <section className="scn-section">
      <h3>Переменные</h3>
      <p className="hint">
        В значении шага используй {'{{имя}}'}; пароль вводится перед запуском и не сохраняется.
      </p>
      <div className="scn-vars">
        {names.map(name => {
          const secret = name === 'password';
          return (
            <div key={name}>
              <label>{`{{${name}}}`}</label>
              <input
                type={secret ? 'password' : 'text'}
                value={secret ? password : values[name] || ''}
                autoComplete="off"
                onChange={e =>
                  secret ? onPassword(e.target.value) : onChange({ ...values, [name]: e.target.value })
                }
              />
            </div>
          );
        })}
        {!names.length && <p className="hint">Переменных нет.</p>}
      </div>
    </section>
  );
}
