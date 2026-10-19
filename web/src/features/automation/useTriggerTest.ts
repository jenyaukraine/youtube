import { useState } from 'react';
import { testTrigger } from '@/api/automation';
import { hostOf } from '@/lib/text';
import type { Job, Step, TriggerTestResult, TriggerWhen } from '@/lib/types';
import { activeTab } from './activeTab';

export interface TestNote {
  text: string;
  ok: boolean;
}

export type TriggerTester = (when: TriggerWhen, then: Step[], run: boolean) => Promise<void>;

/** Проверка триггера на активной вкладке: результат — строка для формы, совпадение подсвечивается на карточке. */
export function useTriggerTest(jobs: Job[]) {
  const [note, setNote] = useState<TestNote | null>(null);

  const test: TriggerTester = async (when, then, run) => {
    const tab = activeTab(jobs);
    if (!tab) {
      setNote({ text: 'Нет своей открытой вкладки: открой страницу из этой панели', ok: false });
      return;
    }
    setNote({ text: `Проверяю на вкладке ${tab.name}…`, ok: true });

    const r = await testTrigger(when, run ? then : [], tab.job, tab.worker, run);
    if (!r.ok) {
      setNote({ text: r.error || 'Проверка не удалась', ok: false });
      return;
    }
    const where = `${hostOf(r.url || '') || 'странице'} (${tab.name})`;
    if (!r.matches) {
      const hidden = r.count ? ` · совпадений в DOM: ${r.count}, но ни одно не видно` : '';
      setNote({ text: `✗ На ${where} сейчас не найдено${hidden}`, ok: false });
      return;
    }
    setNote({ text: describeHit(r, where), ok: true });
    if (r.box) {
      const detail = { job: tab.job, worker: tab.worker, box: r.box };
      window.dispatchEvent(new CustomEvent('katya-hit', { detail }));
    }
  };

  return { note, test };
}

function describeHit(r: TriggerTestResult, where: string) {
  const many = (r.count || 0) > 1 ? ` · элементов: ${r.count}, сработает первый видимый` : '';
  const run = !r.run
    ? ''
    : r.run.ok
      ? ` · реакция выполнена: ${r.run.completed} шагов`
      : ` · реакция остановилась: ${r.run.error || 'ошибка'}`;
  return `✓ Найдено на ${where}${many}${run}`;
}
