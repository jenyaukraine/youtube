import { useRef, useState } from 'react';
import type { ClientRun } from '@/features/scenario/types';
import type { Recorder } from '@/hooks/useRecorder';
import { pause, runScenario, type RunResult } from '@/lib/scenarioRunner';
import { substituteVariables, variablesOf } from '@/lib/steps';
import { errorText } from '@/lib/text';
import { toast } from '@/lib/toast';
import type { ScenarioStatus, Step } from '@/lib/types';
import type { ChromeTabApi } from './useChromeTab';

/** Сколько ждать после загрузки страницы перед первым шагом. */
const SETTLE_MS = 3000;
const PASSWORD = /{{\s*password\s*}}/;

interface Deps {
  recorder: Recorder;
  chrome: ChromeTabApi;
  setPhase: (phase: ScenarioStatus) => void;
}

export interface PlayOptions {
  from?: number;
  /** Страницу только что открыли — перед первым шагом нужна пауза. */
  pageOpened?: boolean;
  targetUrl: string;
  variables?: Record<string, string>;
}

/** Подставляет переменные сценария; пароль и незаполненные переменные останавливают запуск. */
function prepareStep(raw: Step, variables: Record<string, string>): Step {
  if (PASSWORD.test(`${raw.query || ''} ${raw.value || ''}`)) {
    throw new Error('Пароль вводится вручную во вкладке Chrome.');
  }
  const [step] = substituteVariables([raw], variables);
  const [missing] = variablesOf([step]);
  if (missing) throw new Error(`Заполни переменную ${missing} в сценарии.`);
  return step;
}

/** Прогон шагов во вкладке Chrome: прогресс, обратный отсчёт пауз, остановка. */
export function useChromePlayer({ recorder, chrome, setPhase }: Deps) {
  const [clientRun, setClientRun] = useState<ClientRun | null>(null);
  const [message, setMessage] = useState('');
  const [waitLeft, setWaitLeft] = useState(0);
  const cancelled = useRef(false);

  const fail = (text: string, index?: number) => {
    setPhase({ phase: 'error', current: index, completed: index });
    setMessage(text);
    toast(text, 'err');
  };

  const finish = (result: RunResult, total: number) => {
    if (result.ok) {
      setPhase({ phase: 'done', current: total - 1, completed: total });
      setMessage(`Готово · ${recorder.repeat} повторов`);
    } else if (result.stopped) {
      setPhase({});
      setMessage('Остановлено');
    } else {
      fail(`Шаг ${(result.index ?? 0) + 1}: ${result.error}`, result.index ?? 0);
    }
  };

  const reopen = async (targetUrl: string) => {
    const reply = await chrome.execute({ action: 'navigate', value: targetUrl });
    if (!reply.ok) throw new Error(reply.error || 'Не удалось открыть страницу');
  };

  const play = async (
    list: Step[],
    { from = 0, pageOpened = false, targetUrl, variables = {} }: PlayOptions,
  ) => {
    if (!list.length) return;
    cancelled.current = false;
    const stopped = () => cancelled.current;
    recorder.setReplaying(true);
    setPhase({ phase: 'running', current: from, completed: from });
    try {
      const result = await runScenario({
        steps: list,
        from,
        repeats: recorder.repeat,
        cancelled: stopped,
        // Перед повтором страница открывается заново; свежей странице даём время загрузиться.
        beforeRepeat: async pass => {
          if (pass) await reopen(targetUrl);
          if (pass || pageOpened) await pause(SETTLE_MS, stopped, setWaitLeft);
        },
        onStep: index => {
          setClientRun({ index, total: list.length });
          setPhase({ phase: 'running', current: index, completed: index });
        },
        onWait: setWaitLeft,
        execute: async raw => {
          const step = prepareStep(raw, variables);
          if (step.action !== 'screenshot') return chrome.execute(step);
          await chrome.shot();
          return { ok: true };
        },
      });
      finish(result, list.length);
    } catch (error) {
      fail(errorText(error));
    } finally {
      recorder.setReplaying(false);
      setClientRun(null);
      setWaitLeft(0);
      chrome.refreshStatus();
    }
  };

  const stop = () => {
    cancelled.current = true;
  };

  return { clientRun, message, setMessage, waitLeft, play, stop };
}
