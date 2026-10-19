import { useCallback, useMemo, useRef, useState } from 'react';
import { waitStepsFor } from '@/lib/steps';
import { toast } from '@/lib/toast';
import type { Step } from '@/lib/types';

/** Состояние записи шагов, общее для вкладок Playwright и режима «Мой Chrome». */
export interface Recorder {
  steps: Step[];
  recording: boolean;
  replaying: boolean;
  repeat: number;
  /** С какого шага повторять. */
  from: number;
  /** Отмеченные чекбоксами шаги (для удаления списком). */
  picked: Set<number>;
  setSteps: (steps: Step[]) => void;
  setRecording: (on: boolean) => void;
  setReplaying: (on: boolean) => void;
  setRepeat: (n: number) => void;
  setFrom: (index: number) => void;
  /** Клик по шагу: точка старта; повторный клик снимает. */
  pickStart: (index: number) => void;
  togglePick: (index: number, range: boolean) => void;
  unpickAll: () => void;
  deletePicked: () => void;
  patchStep: (index: number, step: Step) => void;
  removeStep: (index: number) => void;
  clear: () => void;
  /** Добавляет шаг из записи: вставляет паузу по времени, склеивает подряд идущий ввод текста. */
  append: (step: Step) => void;
  copyJson: () => Promise<void>;
}

export function useRecorder(onChange?: (steps: Step[]) => void): Recorder {
  const [steps, setStepsState] = useState<Step[]>([]);
  const [recording, setRecording] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [repeat, setRepeat] = useState(1);
  const [from, setFrom] = useState(0);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const lastAt = useRef(0);
  const lastPick = useRef<number | null>(null);

  const setSteps = useCallback(
    (list: Step[]) => {
      setStepsState(list);
      onChange?.(list);
    },
    [onChange],
  );

  const append = useCallback(
    (step: Step) => {
      const now = Date.now();
      setStepsState(prev => {
        const next = [...prev];
        if (lastAt.current && next.length) next.push(...waitStepsFor(now - lastAt.current));
        const last = next[next.length - 1];
        if (step.action === 'type' && last?.action === 'type') {
          next[next.length - 1] = { ...last, value: (last.value || '') + (step.value || '') };
        } else next.push(step);
        onChange?.(next);
        return next;
      });
      lastAt.current = now;
    },
    [onChange],
  );

  const startRecording = useCallback((on: boolean) => {
    if (on) lastAt.current = Date.now();
    setRecording(on);
  }, []);

  const togglePick = useCallback((index: number, range: boolean) => {
    setPicked(prev => {
      const next = new Set(prev);
      const anchor = lastPick.current;
      if (range && anchor != null) {
        for (let i = Math.min(anchor, index); i <= Math.max(anchor, index); i++) next.add(i);
      } else if (next.has(index)) next.delete(index);
      else next.add(index);
      lastPick.current = index;
      return next;
    });
  }, []);

  const unpickAll = useCallback(() => {
    setPicked(new Set());
    setFrom(0);
  }, []);

  return useMemo<Recorder>(
    () => ({
      steps,
      recording,
      replaying,
      repeat,
      from,
      picked,
      setSteps,
      setRecording: startRecording,
      setReplaying,
      setRepeat,
      setFrom,
      pickStart: index => setFrom(from === index ? 0 : index),
      togglePick,
      unpickAll,
      deletePicked: () => {
        const next = steps.filter((_, i) => !picked.has(i));
        if (from >= next.length) setFrom(0);
        setPicked(new Set());
        setSteps(next);
        toast(`Удалено шагов: ${picked.size}`);
      },
      patchStep: (index, step) => setSteps(steps.map((old, i) => (i === index ? step : old))),
      removeStep: index => setSteps(steps.filter((_, i) => i !== index)),
      clear: () => {
        setFrom(0);
        setPicked(new Set());
        setSteps([]);
      },
      append,
      copyJson: async () => {
        try {
          await navigator.clipboard.writeText(JSON.stringify(steps, null, 2));
          toast('Шаги скопированы как JSON');
        } catch {
          toast('Не удалось скопировать', 'err');
        }
      },
    }),
    [
      steps,
      recording,
      replaying,
      repeat,
      from,
      picked,
      setSteps,
      startRecording,
      togglePick,
      unpickAll,
      append,
    ],
  );
}
