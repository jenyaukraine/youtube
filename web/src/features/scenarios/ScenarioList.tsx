import { useRef } from 'react';
import { deleteMacro } from '@/api/automation';
import { cx } from '@/lib/cx';
import { stepsCount } from '@/lib/text';
import { toast, toastResult } from '@/lib/toast';
import type { Macro, Scenario } from '@/lib/types';
import { exportScenarios, importScenarios } from './scenarioFiles';

interface Props {
  scenarios: Scenario[];
  macros: Macro[];
  selected: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onCopyMacro: (macro: Macro) => void;
  /** Перечитать библиотеку после импорта или удаления макроса. */
  onChanged: () => void;
}

/** Боковая панель: локальные сценарии, макросы с сервера, импорт и экспорт JSON. */
export function ScenarioList(props: Props) {
  const { scenarios, macros, selected, onSelect, onCreate, onCopyMacro, onChanged } = props;
  const fileInput = useRef<HTMLInputElement>(null);

  const removeMacro = async (macro: Macro) => {
    if (!confirm(`Удалить «${macro.name}»?`)) return;
    toastResult(await deleteMacro(macro.name), 'Удалено');
    onChanged();
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const count = await importScenarios(file);
      onChanged();
      toast(`Импортировано: ${count}`);
    } catch {
      toast('Не удалось прочитать JSON', 'err');
    }
  };

  return (
    <aside className="panel scn-sidebar">
      <h2>Мои сценарии</h2>
      <button type="button" className="btn btn-primary btn-block" onClick={onCreate}>
        + Новый сценарий
      </button>
      <div className="scn-list">
        {scenarios.map(s => (
          <button
            key={s.id}
            type="button"
            className={cx('scn-item', { active: s.id === selected })}
            onClick={() => onSelect(s.id)}
          >
            <strong>{s.name}</strong>
            <small>
              {stepsCount(s.steps.length)} · {s.startUrl}
            </small>
          </button>
        ))}
      </div>
      {macros.length > 0 && (
        <>
          <h3>На сервере</h3>
          <div className="scn-list">
            {macros.map(m => (
              <div className="scn-macro" key={m.name}>
                <button type="button" className="scn-macro-open" onClick={() => onCopyMacro(m)}>
                  <strong>{m.name}</strong>
                  <small>{stepsCount(m.steps.length)} · открыть для изменения</small>
                </button>
                <button type="button" className="scn-macro-remove" onClick={() => removeMacro(m)}>
                  Удалить
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="btn-row scn-files">
        <button type="button" className="btn" onClick={() => exportScenarios(scenarios)}>
          Скачать JSON
        </button>
        <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
          Импорт JSON
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json"
          hidden
          onChange={e => importFile(e.target.files?.[0])}
        />
      </div>
      <p className="hint">
        Сценарии хранятся в этом браузере и как макросы на сервере. Запись — во вкладке: «● Записать шаги»,
        затем «💾 Сохранить».
      </p>
    </aside>
  );
}
