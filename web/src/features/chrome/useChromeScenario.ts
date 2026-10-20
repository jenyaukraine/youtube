import { useCallback, useRef, useState } from 'react';
import { saveMacro } from '@/api/automation';
import type { Library } from '@/hooks/useLibrary';
import { useRecorder } from '@/hooks/useRecorder';
import { findSource } from '@/lib/sources';
import { newScenarioName } from '@/lib/steps';
import { addLocalScenario, lastUrl, setLastUrl } from '@/lib/storage';
import { errorText, isHttpUrl, stepsCount } from '@/lib/text';
import { toast } from '@/lib/toast';
import type { ScenarioStatus, Step } from '@/lib/types';
import { chromeBridge, recordedEventsToSteps } from './bridge';
import { useChromePlayer } from './useChromePlayer';
import { useChromeTab } from './useChromeTab';

const DEFAULT_URL = 'https://www.youtube.com/watch?v=i6XB07FpBG0';

/** Режим «Мой Chrome» целиком: подключение, рекордер, запуск, запись и сохранение сценария. */
export function useChromeScenario(library: Library) {
  const [phase, setPhase] = useState<ScenarioStatus>({});
  const clearPhase = useCallback(() => setPhase({}), []);
  const recorder = useRecorder(clearPhase);
  const chrome = useChromeTab(recorder);
  const player = useChromePlayer({ recorder, chrome, setPhase });
  const [url, setUrl] = useState(() => lastUrl(DEFAULT_URL));
  const [choice, setChoice] = useState('');
  const [chip, setChip] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const startUrl = useRef(url);

  const source = (value: string) => findSource(value, library.scenarios, library.macros);

  const start = async () => {
    const target = url.trim();
    if (!isHttpUrl(target)) {
      toast('Укажи полный адрес страницы', 'err');
      return;
    }
    setBusy(true);
    try {
      const opened = chrome.tab?.url !== target;
      if (opened) await chrome.open(target);
      setLastUrl(target);
      startUrl.current = target;
      const selected = source(choice);
      if (selected?.steps.length) {
        const list = structuredClone(selected.steps);
        recorder.setSteps(list);
        await player.play(list, { pageOpened: opened, targetUrl: target, variables: selected.variables });
      } else {
        player.setMessage('Вкладка подключена · можно записывать действия');
        await chrome.refreshStatus();
      }
      chrome.shot();
    } catch (error) {
      toast(errorText(error), 'err');
    } finally {
      setBusy(false);
    }
  };

  const toggleRecord = async () => {
    const next = !recorder.recording;
    const reply = await chromeBridge('record', { enabled: next });
    if (!reply.ok) {
      toast(reply.error || 'Не удалось включить запись', 'err');
      return;
    }
    recorder.setRecording(next);
    if (next) {
      recorder.clear();
      startUrl.current = chrome.tab?.url || url;
      player.setMessage('Запись идёт');
      return;
    }
    const events = await chromeBridge('events');
    if (!events.ok || !Array.isArray(events.events)) return;
    const list = recordedEventsToSteps(events.events);
    recorder.setSteps(list);
    player.setMessage(`Записано: ${stepsCount(list.length)} · паузы учтены`);
  };

  const save = async () => {
    const { steps } = recorder;
    if (!steps.length) {
      toast('Сначала запиши действия', 'err');
      return;
    }
    const target = startUrl.current || url;
    const name = newScenarioName(target, steps.length);
    addLocalScenario({ name, startUrl: target, steps });
    library.refresh();
    const result = await saveMacro({ name, steps, start_url: target, description: target });
    if (result.ok) toast(`Сохранено: ${name}`);
    else toast(`Локально сохранено; сервер: ${result.error}`, 'err');
  };

  const load = (value: string) => {
    setChoice(value);
    const found = source(value);
    if (!found?.steps.length) return;
    recorder.setSteps(structuredClone(found.steps));
    startUrl.current = found.startUrl || url;
  };

  const playFrom = (from: number) =>
    player.play(recorder.steps, {
      from,
      targetUrl: startUrl.current || url,
      variables: source(choice)?.variables,
    });

  const replay = () => (recorder.replaying ? player.stop() : playFrom(recorder.from));
  const runFromChip = () => playFrom(chip ?? 0);

  const pickChip = (index: number | null) => {
    setChip(index);
    recorder.setFrom(index ?? 0);
  };

  const manual = async (step: Step) => {
    const reply = await chrome.execute(step);
    if (!reply.ok) toast(reply.error || 'Действие не выполнено', 'err');
  };

  return {
    recorder,
    chrome,
    url,
    setUrl,
    choice,
    phase,
    chip,
    busy,
    clientRun: player.clientRun,
    message: player.message,
    waitLeft: player.waitLeft,
    start,
    stop: player.stop,
    replay,
    runFromChip,
    pickChip,
    toggleRecord,
    save,
    load,
    manual,
  };
}

export type ChromeScenario = ReturnType<typeof useChromeScenario>;
