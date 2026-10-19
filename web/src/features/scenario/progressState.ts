import type { ScenarioProgressProps } from './types';

type ProgressInput = Pick<ScenarioProgressProps, 'steps' | 'status' | 'clientRun'>;

/** Единая трактовка состояния: повтор на клиенте перекрывает статус сервера. */
export function runState({ steps, status, clientRun }: ProgressInput) {
  const total = steps.length;
  const running = clientRun ? true : status.phase === 'running';
  const cur = clientRun ? clientRun.index : status.current || 0;
  const completed = clientRun ? clientRun.index : status.completed || 0;
  const done = !clientRun && status.phase === 'done';
  const error = !clientRun && status.phase === 'error';
  const waiting = !clientRun && status.phase === 'waiting';
  return { total, running, cur, completed, done, error, waiting };
}

/** Короткая строка для шапки панели: «Выполняется · 3/7». */
export function statusLine(progress: ProgressInput): string {
  const { total, running, completed, done, error } = runState(progress);
  if (progress.clientRun) return `Повтор из записи · ${progress.clientRun.index}/${progress.clientRun.total}`;
  if (done) return `Готово · ${total}/${total}`;
  if (error) return `Остановлен · ${completed}/${total}`;
  if (running) return `Выполняется · ${completed}/${total}`;
  return '';
}
