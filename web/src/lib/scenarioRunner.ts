import { clamp } from './text';
import type { ActionResult, Step } from './types';

export interface RunOptions {
  steps: Step[];
  from?: number;
  repeats?: number;
  execute: (step: Step) => Promise<ActionResult>;
  beforeRepeat?: (repeat: number) => Promise<void>;
  onStep?: (index: number, repeat: number) => void;
  onWait?: (remainingMs: number) => void;
  afterStep?: (index: number) => Promise<void>;
  cancelled?: () => boolean;
}

export interface RunResult {
  ok: boolean;
  stopped: boolean;
  completed: number;
  index?: number;
  repeat?: number;
  error?: string;
}

/** Пауза с отменой и тиканьем обратного отсчёта. Возвращает false, если отменили. */
export async function pause(
  ms: number,
  cancelled: () => boolean = () => false,
  onTick?: (remainingMs: number) => void,
) {
  const end = Date.now() + clamp(ms, 0, 60000);
  while (!cancelled() && Date.now() < end) {
    onTick?.(end - Date.now());
    await new Promise(resolve => setTimeout(resolve, clamp(end - Date.now(), 1, 100)));
  }
  onTick?.(0);
  return !cancelled();
}

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Единый порядок выполнения для Playwright и расширения Chrome. */
export async function runScenario(options: RunOptions): Promise<RunResult> {
  const { steps, execute, beforeRepeat, onStep, onWait, afterStep } = options;
  const cancelled = options.cancelled || (() => false);
  const repeats = clamp(options.repeats || 1, 1, 100);
  const from = clamp(options.from || 0, 0, steps.length - 1);
  let completed = 0;

  for (let repeat = 0; repeat < repeats; repeat++) {
    if (cancelled()) return { ok: false, stopped: true, completed };
    await beforeRepeat?.(repeat);
    for (let index = from; index < steps.length; index++) {
      if (cancelled()) return { ok: false, stopped: true, completed };
      onStep?.(index, repeat);
      const step = steps[index];
      const result =
        step.action === 'wait'
          ? { ok: await pause(Number(step.value || step.duration_ms) || 0, cancelled, onWait) }
          : await execute(step);
      if (!result.ok) {
        return {
          ok: false,
          stopped: cancelled(),
          completed,
          index,
          repeat,
          error: result.error || 'Действие не выполнено',
        };
      }
      completed++;
      await afterStep?.(index);
    }
  }
  return { ok: true, stopped: false, completed };
}
