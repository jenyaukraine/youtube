import type { KeyboardEvent } from 'react';
import type { Library } from '@/hooks/useLibrary';
import { cx } from '@/lib/cx';
import { sourceOptions } from '@/lib/sources';
import type { LaunchMode } from '@/lib/storage';
import { MethodSwitch } from '@/ui/MethodSwitch';
import { SourceSelect } from '@/ui/SourceSelect';
import { ExtensionUpdate } from './ExtensionUpdate';
import { TabPicker } from './TabPicker';
import type { ChromeScenario } from './useChromeScenario';
import { REQUIRED_VERSION, type ChromeTabApi } from './useChromeTab';

interface Props {
  scenario: ChromeScenario;
  library: Library;
  mode: LaunchMode;
  onMode: (mode: LaunchMode) => void;
}

function connectionText(chrome: ChromeTabApi) {
  if (!chrome.connected) return 'Расширение не найдено';
  if (!chrome.ready) return `Нужно обновить до ${REQUIRED_VERSION}`;
  return 'Chrome подключён';
}

/** Левая карточка: адрес, способ запуска, состояние расширения, выбор сценария и запуск. */
export function ChromeControlCard({ scenario, library, mode, onMode }: Props) {
  const { chrome, recorder } = scenario;
  const hasScenario = scenario.choice !== '' && recorder.steps.length > 0;
  const tabLine = chrome.tab ? `${chrome.tab.title} · ${chrome.tab.url}` : 'Подключённой вкладки пока нет';

  const onUrlKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') scenario.start();
  };

  return (
    <div className="card chrome-control">
      <h2>Открыть вкладку</h2>

      <label htmlFor="chrome-url">Адрес страницы</label>
      <input
        id="chrome-url"
        type="url"
        value={scenario.url}
        placeholder="https://"
        spellCheck={false}
        onChange={event => scenario.setUrl(event.target.value)}
        onKeyDown={onUrlKey}
      />

      <label>Способ запуска</label>
      <MethodSwitch value={mode} onChange={onMode} />

      <div className={cx('chrome-connection', chrome.ready ? 'ok' : 'err')}>
        <strong>{connectionText(chrome)}</strong>
        <small title={tabLine}>{tabLine}</small>
      </div>

      <TabPicker chrome={chrome} />
      <ExtensionUpdate chrome={chrome} />

      <label htmlFor="chrome-source">Сценарий при открытии</label>
      <SourceSelect
        id="chrome-source"
        value={scenario.choice}
        options={sourceOptions(library.scenarios, library.macros)}
        placeholder="Нет, просто открыть страницу"
        onChange={scenario.load}
      />
      <div className="hint">После загрузки страницы сценарий ждёт 3 секунды. Шаги видны справа.</div>

      <div className="btn-row chrome-actions">
        <button
          type="button"
          className="btn btn-primary btn-lg"
          disabled={scenario.busy || !chrome.ready}
          onClick={scenario.start}
        >
          {hasScenario ? 'Запустить сценарий' : 'Открыть в Chrome'}
        </button>
        <button type="button" className="btn btn-lg" disabled={!recorder.replaying} onClick={scenario.stop}>
          Стоп
        </button>
      </div>
    </div>
  );
}
