import { useRef, useState } from 'react';
import { runAction } from '@/api/tabs';
import type { ClientRun } from '@/features/scenario/types';
import type { Recorder } from '@/hooks/useRecorder';
import { runScenario, sleep } from '@/lib/scenarioRunner';
import { hasVariables } from '@/lib/steps';
import { toast } from '@/lib/toast';
import type { Job, Step, Worker } from '@/lib/types';

interface Options {
  job: Job;
  worker: Worker;
  recorder: Recorder;
  requestFrame: () => void;
}

const REPEAT_GAP_MS = 500;
/** Пауза между шагами, если в записи нет своих пауз. */
const STEP_GAP_MS = 1200;

/** Повтор записанных шагов во вкладке с прогрессом и остановкой. */
export function useReplay({ job, worker, recorder, requestFrame }: Options) {
  const [clientRun, setClientRun] = useState<ClientRun | null>(null);
  const cancel = useRef(false);

  const stop = () => {
    cancel.current = true;
  };

  const replay = async (steps: Step[], from: number) => {
    if (!steps.length) {
      toast('Нет записанных шагов', 'err');
      return;
    }
    if (hasVariables(steps)) {
      toast('В записи есть переменные. Задай их на странице «Сценарии»', 'err');
      return;
    }
    const repeats = recorder.repeat;
    // Прогресс по фишкам показываем, только когда повторяем сценарий самой вкладки.
    const showProgress = job.scenario_steps?.length === steps.length;
    const noWaits = !steps.some(step => step.action === 'wait');
    cancel.current = false;
    recorder.setReplaying(true);
    requestFrame();

    let runs = 0;
    let failedStep = 0;
    try {
      const result = await runScenario({
        steps,
        from,
        repeats,
        cancelled: () => cancel.current,
        beforeRepeat: async pass => {
          if (pass) await sleep(REPEAT_GAP_MS);
          runs = pass;
        },
        onStep: index => {
          if (showProgress) setClientRun({ index, total: steps.length });
        },
        execute: async step => {
          const result = await runAction(job.id, worker.id, step);
          requestFrame();
          return result;
        },
        afterStep: async index => {
          if (noWaits && index < steps.length - 1) await sleep(STEP_GAP_MS);
        },
      });
      if (result.ok) runs = repeats;
      else if (!result.stopped) failedStep = (result.index ?? 0) + 1;
    } finally {
      recorder.setReplaying(false);
      setClientRun(null);
    }

    if (failedStep) toast(`Сбой на повторе ${runs + 1}, шаг ${failedStep}`, 'err');
    else if (cancel.current) toast(`Остановлено: ${runs} из ${repeats}`, 'err');
    else toast(`Выполнено повторов: ${runs}`);
  };

  return { clientRun, replay, stop };
}
