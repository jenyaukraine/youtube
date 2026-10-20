import { useState } from 'react';
import { errorText } from '@/lib/text';
import { updateInstalledExtension } from './updater';
import type { ChromeTabApi } from './useChromeTab';

interface Props {
  chrome: Pick<ChromeTabApi, 'connected' | 'ready' | 'refreshStatus'>;
}

const DEFAULT_HINT =
  'При первом обновлении выберите папку установленного расширения. Затем достаточно кнопки.';

/** Установка и обновление расширения из панели; раскрыт сам, когда версия не подходит. */
export function ExtensionUpdate({ chrome }: Props) {
  const [updating, setUpdating] = useState(false);
  const [note, setNote] = useState('');

  const update = async () => {
    setUpdating(true);
    try {
      const result = await updateInstalledExtension();
      setNote(
        result.reloaded
          ? `Версия ${result.version} установлена.`
          : `Файлы ${result.version} установлены. Один раз нажмите «Обновить» в chrome://extensions.`,
      );
      window.setTimeout(chrome.refreshStatus, 1800);
    } catch (error) {
      // Отмена диалога выбора папки — не ошибка.
      const aborted = error instanceof Error && error.name === 'AbortError';
      if (!aborted) setNote(errorText(error));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <details className="fold" open={chrome.connected && !chrome.ready}>
      <summary>Установка и обновление расширения</summary>
      <button type="button" className="btn btn-accent btn-block" disabled={updating} onClick={update}>
        {updating ? 'Обновляю…' : 'Обновить расширение'}
      </button>
      <div className="hint" aria-live="polite">
        {note || DEFAULT_HINT}
      </div>
      <p className="chrome-zip">
        <a href="/Katya-Browser-Bridge.zip" download>
          Скачать ZIP для первой установки ↗
        </a>
      </p>
    </details>
  );
}
