import { useState, type SyntheticEvent } from 'react';
import type { ChromeTab } from './bridge';
import type { ChromeTabApi } from './useChromeTab';

interface Props {
  chrome: Pick<ChromeTabApi, 'listTabs' | 'attach'>;
}

/** Открытые вкладки Chrome; клик подключает вкладку к панели. Список читается при раскрытии. */
export function TabPicker({ chrome }: Props) {
  const [tabs, setTabs] = useState<ChromeTab[]>([]);

  const onToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (event.currentTarget.open) chrome.listTabs().then(setTabs);
  };

  return (
    <details className="fold" onToggle={onToggle}>
      <summary>Подключить открытую вкладку</summary>
      <div className="chrome-tab-list">
        {tabs.length === 0 && <div className="hint">Открытых вкладок не найдено</div>}
        {tabs.map(tab => (
          <button type="button" key={tab.id} onClick={() => chrome.attach(tab.id)}>
            <b>{tab.title || tab.url}</b>
            <small>{tab.url}</small>
          </button>
        ))}
      </div>
    </details>
  );
}
