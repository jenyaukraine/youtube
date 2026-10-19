import { useMemo, type MutableRefObject } from 'react';
import { saveMacro } from '@/api/automation';
import type { Library } from '@/hooks/useLibrary';
import type { Recorder } from '@/hooks/useRecorder';
import { findSource, sourceOptions } from '@/lib/sources';
import { newScenarioName } from '@/lib/steps';
import { addLocalScenario, drafts, removeDraft } from '@/lib/storage';
import { toast } from '@/lib/toast';
import type { Worker } from '@/lib/types';

interface Options {
  worker: Worker;
  library: Library;
  recorder: Recorder;
  /** Адрес, с которого началась запись; пустой — берём текущий адрес вкладки. */
  startUrlRef: MutableRefObject<string>;
}

/** Сохранение записи в библиотеку и загрузка шагов из сценария, макроса или черновика другой вкладки. */
export function useScenarioLibrary({ worker, library, recorder, startUrlRef }: Options) {
  const loadOptions = useMemo(
    () =>
      sourceOptions(
        library.scenarios,
        library.macros,
        drafts().filter(d => d.key !== worker.id),
      ),
    [library.scenarios, library.macros, worker.id],
  );

  const save = async () => {
    const steps = recorder.steps;
    if (!steps.length) {
      toast('Сначала запиши хотя бы одно действие', 'err');
      return;
    }
    const url = startUrlRef.current || worker.url;
    const name = newScenarioName(url, steps.length);
    const settings = { user_agent_mode: 'chrome' };
    addLocalScenario({ name, startUrl: url, steps, settings });
    const result = await saveMacro({ name, steps, description: url, start_url: url, settings });
    removeDraft(worker.id);
    library.refresh();
    if (result.ok) toast(`Сохранено: ${name}`);
    else toast(`Сохранено в этом браузере; сервер: ${result.error || 'ошибка'}`, 'err');
  };

  const load = (value: string) => {
    const source = findSource(value, library.scenarios, library.macros, drafts());
    if (!source?.steps.length) {
      toast('Запись не найдена', 'err');
      return;
    }
    startUrlRef.current = source.startUrl || worker.url;
    recorder.unpickAll();
    recorder.setSteps(structuredClone(source.steps));
    toast(`Загружено шагов: ${source.steps.length}. Нажми «▶ Повторить»`);
  };

  return { loadOptions, save, load };
}
