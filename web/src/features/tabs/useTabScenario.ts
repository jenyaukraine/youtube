import { useCallback, useEffect, useRef, useState } from 'react';
import { runAction } from '@/api/tabs';
import type { ScenarioPanelProps } from '@/features/scenario/types';
import type { Library } from '@/hooks/useLibrary';
import { useRecorder } from '@/hooks/useRecorder';
import { normalizeSteps } from '@/lib/steps';
import { controlToken, drafts, rememberedSteps, saveDraft } from '@/lib/storage';
import { stepsCount } from '@/lib/text';
import { toast, toastResult } from '@/lib/toast';
import type { ActionResult, Job, Step, Worker } from '@/lib/types';
import { useReplay } from './useReplay';
import { useScenarioLibrary } from './useScenarioLibrary';

export interface ActOptions {
  /** Без тоста о результате. */
  quiet?: boolean;
  /** false — не добавлять шаг в запись. */
  record?: boolean;
}

export type Act = (step: Step, options?: ActOptions) => Promise<ActionResult | null>;

interface Options {
  job: Job;
  worker: Worker;
  library: Library;
  requestFrame: () => void;
}

/** Клик по точке дополняем селектором и прокруткой, которые нашёл сервер — так повтор устойчивее. */
function withTarget(step: Step, result: ActionResult): Step {
  if (step.action !== 'point') return step;
  return {
    ...step,
    query: result.selector || step.query,
    scroll_state: result.scroll_state || step.scroll_state,
  };
}

/** Действия, запись, повтор и фишки стартового сценария для одной вкладки. */
export function useTabScenario({ job, worker, library, requestFrame }: Options) {
  const owned = Boolean(controlToken(job.id));
  const startUrlRef = useRef('');
  const currentUrl = useRef(worker.url);
  const [chipPicked, setChipPicked] = useState<number | null>(null);

  useEffect(() => {
    currentUrl.current = worker.url;
  }, [worker.url]);

  const persist = useCallback(
    (steps: Step[]) => saveDraft(worker.id, startUrlRef.current || currentUrl.current, steps),
    [worker.id],
  );
  const recorder = useRecorder(persist);
  const { setSteps, append, recording } = recorder;
  const { clientRun, replay, stop } = useReplay({ job, worker, recorder, requestFrame });
  const { loadOptions, save, load } = useScenarioLibrary({ worker, library, recorder, startUrlRef });

  // Черновик этой вкладки переживает перезагрузку панели.
  useEffect(() => {
    const draft = drafts().find(d => d.key === worker.id);
    if (!draft?.steps.length) return;
    startUrlRef.current = draft.startUrl;
    setSteps(draft.steps);
  }, [worker.id, setSteps]);

  const act = useCallback<Act>(
    async (step, options = {}) => {
      if (!owned) {
        toast('Эта вкладка открыта не из этой панели: действия недоступны', 'err');
        return null;
      }
      const result = await runAction(job.id, worker.id, step);
      requestFrame();
      if (!options.quiet) toastResult(result, 'Действие выполнено', 'Действие не выполнено');
      const skip = options.record === false || step.action === 'inspect' || step.action === 'move';
      if (result.ok && recording && !skip) append(withTarget(step, result));
      return result;
    },
    [owned, job.id, worker.id, requestFrame, recording, append],
  );

  const toggleRecord = () => {
    requestFrame();
    if (!recording && !recorder.steps.length) startUrlRef.current = worker.url;
    recorder.setRecording(!recording);
  };

  const onReplay = () => {
    if (recorder.replaying) stop();
    else void replay(recorder.steps, recorder.from);
  };

  // Фишки стартового сценария: полный список шагов помним с момента запуска, snapshot сервера — запасной.
  const scenarioSteps = job.scenario_steps || [];
  const fullSteps = () => {
    const remembered = rememberedSteps(job.id);
    return normalizeSteps(remembered?.length === scenarioSteps.length ? remembered : scenarioSteps);
  };

  const pick = (index: number | null) => {
    const next = index === chipPicked ? null : index;
    setChipPicked(next);
    recorder.setFrom(next ?? 0);
    if (next != null) setSteps(fullSteps());
  };

  const runFromPick = () => {
    const steps = fullSteps();
    const from = chipPicked ?? 0;
    setChipPicked(null);
    recorder.setFrom(from);
    setSteps(steps);
    void replay(steps, from);
  };

  const count = recorder.steps.length;
  const statusText = recording
    ? `● Запись идёт · ${stepsCount(count)} · паузы между действиями сохраняются`
    : count
      ? `${stepsCount(count)} · черновик сохранён в этом браузере`
      : 'Действия на кадре и ручные действия записываются после «● Записать шаги».';

  const panel: ScenarioPanelProps = {
    progress: {
      steps: scenarioSteps,
      status: worker.scenario || {},
      clientRun,
      picked: chipPicked,
      onPick: pick,
      onRun: runFromPick,
    },
    recorder,
    statusText,
    loadOptions,
    onToggleRecord: toggleRecord,
    onReplay,
    onSave: save,
    onLoad: load,
    onManual: step => void act(step),
  };

  const active = recording || recorder.replaying || worker.scenario?.phase === 'running';

  return { act, active, panel };
}
