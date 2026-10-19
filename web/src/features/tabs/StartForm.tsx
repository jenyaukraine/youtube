import { ownedJob } from '@/api/client';
import { stopJob } from '@/api/tabs';
import type { Library } from '@/hooks/useLibrary';
import { cx } from '@/lib/cx';
import type { LaunchMode } from '@/lib/storage';
import { toastResult } from '@/lib/toast';
import type { Job } from '@/lib/types';
import { MethodSwitch } from '@/ui/MethodSwitch';
import { SourceSelect } from '@/ui/SourceSelect';
import { openTabs } from './TabsPanel';
import { useStartForm } from './useStartForm';
import './tabs.css';

interface Props {
  jobs: Job[];
  library: Library;
  mode: LaunchMode;
  onMode: (mode: LaunchMode) => void;
}

const DURATIONS: [number, string][] = [
  [0, 'Без лимита'],
  [1800, '30 мин'],
  [3600, '1 час'],
];

const UA_MODES: [string, string][] = [
  ['chrome', 'Родной профиль браузера'],
  ['random', 'Случайный Chrome или Edge'],
  ['browser', 'Браузер без профиля'],
];

/** Форма «Открыть вкладки»: адрес, способ запуска, потоки, длительность, профиль, сценарий, заголовки. */
export function StartForm({ jobs, library, mode, onMode }: Props) {
  const { form, patch, busy, options, chooseSource, start } = useStartForm(library);
  const own = ownedJob(jobs);
  const open = openTabs(jobs).length;

  const stop = async () => {
    if (!own) return;
    toastResult(await stopJob(own.id), 'Вкладки закрываются');
  };

  return (
    <div className="card start-form">
      <h2>Открыть вкладки</h2>

      <label htmlFor="startUrl">Адрес страницы</label>
      <input
        id="startUrl"
        type="url"
        value={form.url}
        onChange={event => patch({ url: event.target.value })}
        onKeyDown={event => event.key === 'Enter' && void start()}
        placeholder="https://example.com"
        spellCheck={false}
        autoComplete="url"
      />
      <div className="hint">Любой полный http:// или https:// URL.</div>

      <label>Способ запуска</label>
      <MethodSwitch value={mode} onChange={onMode} />

      <label htmlFor="startWorkers">Потоков (параллельных окон)</label>
      <div className="start-range">
        <input
          id="startWorkers"
          type="range"
          min={1}
          max={8}
          value={form.workers}
          onChange={event => patch({ workers: Number(event.target.value) })}
        />
        <output className="start-range-value" htmlFor="startWorkers">
          {form.workers}
        </output>
      </div>

      <label>Длительность сессии</label>
      <div className="seg">
        {DURATIONS.map(([value, title]) => (
          <button
            key={value}
            type="button"
            className={cx('btn', form.duration === value && 'on')}
            onClick={() => patch({ duration: value })}
          >
            {title}
          </button>
        ))}
      </div>

      <label htmlFor="startUaMode">Профиль браузера для каждой вкладки</label>
      <select id="startUaMode" value={form.uaMode} onChange={event => patch({ uaMode: event.target.value })}>
        {UA_MODES.map(([value, title]) => (
          <option key={value} value={value}>
            {title}
          </option>
        ))}
      </select>

      <label htmlFor="startScenario">Сценарий при открытии</label>
      <SourceSelect
        id="startScenario"
        value={form.source}
        options={options}
        placeholder="Нет, просто открыть страницу"
        onChange={chooseSource}
      />
      <div className="hint">Вкладка откроет адрес и через 1 секунду выполнит сохранённые шаги.</div>

      <details className="fold">
        <summary>HTTP-заголовки для новых вкладок</summary>
        <textarea
          value={form.headers}
          onChange={event => patch({ headers: event.target.value })}
          spellCheck={false}
          placeholder='{"Accept-Language":"ru-RU,ru;q=0.9"}'
        />
        <div className="hint">
          JSON. Применяются ко всем запросам вкладки. Cookie и Authorization сюда не вводи.
        </div>
      </details>

      <div className="btn-row start-actions">
        <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={start}>
          Запустить
        </button>
        <button type="button" className="btn btn-lg" disabled={!own} onClick={stop}>
          Стоп
        </button>
      </div>
      {open > 0 && <div className="hint start-count">Открыто вкладок: {open}</div>}
    </div>
  );
}
