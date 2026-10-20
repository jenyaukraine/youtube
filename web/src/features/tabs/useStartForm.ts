import { useMemo, useState } from 'react';
import { startTabs } from '@/api/tabs';
import type { Library } from '@/hooks/useLibrary';
import { findSource, sourceOptions } from '@/lib/sources';
import { serverStep } from '@/lib/steps';
import { lastUrl, setLastUrl } from '@/lib/storage';
import { isHttpUrl } from '@/lib/text';
import { toast } from '@/lib/toast';

export interface StartFields {
  url: string;
  workers: number;
  duration: number;
  uaMode: string;
  source: string;
  /** JSON-объект заголовков как текст. */
  headers: string;
}

function parseHeaders(text: string): Record<string, string> | null {
  try {
    const parsed: unknown = JSON.parse(text.trim() || '{}');
    const isObject = Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed);
    return isObject ? (parsed as Record<string, string>) : null;
  } catch {
    return null;
  }
}

/** Состояние формы «Открыть вкладки»: поля, подстановка настроек из сценария, запуск. */
export function useStartForm(library: Library) {
  const [form, setForm] = useState<StartFields>({
    url: lastUrl(),
    workers: 1,
    duration: 0,
    uaMode: 'chrome',
    source: '',
    headers: '',
  });
  const [busy, setBusy] = useState(false);

  const patch = (changes: Partial<StartFields>) => setForm(current => ({ ...current, ...changes }));

  const options = useMemo(
    () => sourceOptions(library.scenarios, library.macros),
    [library.scenarios, library.macros],
  );

  const chooseSource = (value: string) => {
    const changes: Partial<StartFields> = { source: value };
    const applied: string[] = [];
    const source = value ? findSource(value, library.scenarios, library.macros) : null;
    const headers = source?.settings?.headers;
    if (headers && Object.keys(headers).length) {
      changes.headers = JSON.stringify(headers, null, 1);
      applied.push('заголовки');
    }
    if (source?.settings?.user_agent_mode) {
      changes.uaMode = source.settings.user_agent_mode;
      applied.push('профиль браузера');
    }
    if (source?.startUrl && isHttpUrl(source.startUrl)) {
      changes.url = source.startUrl;
      applied.push('адрес');
    }
    patch(changes);
    if (applied.length) toast(`Из сценария: ${applied.join(', ')}`);
  };

  const start = async () => {
    const url = form.url.trim();
    if (!isHttpUrl(url)) {
      toast('Вставь полный адрес страницы', 'err');
      return;
    }
    const headers = parseHeaders(form.headers);
    if (!headers) {
      toast('Заголовки должны быть JSON-объектом', 'err');
      return;
    }
    const source = form.source ? findSource(form.source, library.scenarios, library.macros) : null;
    setBusy(true);
    const reply = await startTabs({
      url,
      workers: form.workers,
      duration: form.duration,
      headers,
      user_agent_mode: form.uaMode,
      steps: (source?.steps || []).map(serverStep),
    });
    setBusy(false);
    if (!reply.ok) {
      toast(reply.error || 'Ошибка запуска', 'err');
      return;
    }
    setLastUrl(url);
    toast(`Запускаю вкладок: ${reply.workers}`);
  };

  return { form, patch, busy, options, chooseSource, start };
}
