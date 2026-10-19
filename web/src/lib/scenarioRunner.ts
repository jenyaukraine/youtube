import type { ActionResult, Step } from './types';

export interface ScenarioRunOptions {
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

export async function scenarioPause(ms: number, cancelled: () => boolean = () => false, onTick?: (remainingMs: number) => void) {
  const end = Date.now() + Math.max(0, Math.min(60000, ms));
  while (!cancelled() && Date.now() < end) {
    onTick?.(Math.max(0, end - Date.now()));
    await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(1, end - Date.now()))));
  }
  onTick?.(0);
  return !cancelled();
}

/** Shared execution order for Playwright and the installed Chrome extension. */
export async function runScenario(options: ScenarioRunOptions) {
  const { steps, execute, beforeRepeat, onStep, onWait, afterStep } = options;
  const cancelled = options.cancelled || (() => false);
  const repeats = Math.max(1, Math.min(100, options.repeats || 1));
  const from = Math.max(0, Math.min(steps.length - 1, options.from || 0));
  let completed = 0;
  for (let repeat = 0; repeat < repeats; repeat++) {
    if (cancelled()) return { ok: false, stopped: true, completed };
    await beforeRepeat?.(repeat);
    for (let index = from; index < steps.length; index++) {
      if (cancelled()) return { ok: false, stopped: true, completed };
      onStep?.(index, repeat);
      const step = steps[index];
      const result = step.action === 'wait'
        ? { ok: await scenarioPause(Number(step.value || step.duration_ms) || 0, cancelled, onWait) }
        : await execute(step);
      if (!result.ok) return { ok: false, stopped: cancelled(), completed, index, repeat, error: result.error || 'Действие не выполнено' };
      completed++;
      await afterStep?.(index);
    }
  }
  return { ok: true, stopped: false, completed };
}
