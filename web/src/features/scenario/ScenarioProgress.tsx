import { useEffect, useRef, useState } from 'react';
import { cx } from '@/lib/cx';
import { describeStep } from '@/lib/steps';
import { stepsCount } from '@/lib/text';
import { runState } from './progressState';
import type { ScenarioProgressProps } from './types';

/** Секунды до старта по wait_until, пока сценарий в фазе ожидания. */
function useCountdown(active: boolean, until: number | undefined) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!active) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((until || 0) - Date.now() / 1000)));
    tick();
    const timer = window.setInterval(tick, 300);
    return () => window.clearInterval(timer);
  }, [active, until]);
  return left;
}

/** Прогресс сценария, с которым открыта вкладка: строка «сейчас», дорожка и фишки шагов. */
export function ScenarioProgress(props: ScenarioProgressProps) {
  const { steps, status, picked, onPick, onRun } = props;
  const { total, running, cur, completed, done, error, waiting } = runState(props);
  const countdown = useCountdown(waiting, status.wait_until);
  const listRef = useRef<HTMLOListElement>(null);
  const label = (i: number) => describeStep(steps[i]);

  useEffect(() => {
    if (!running) return;
    const chip = listRef.current?.querySelector('li.current');
    chip?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [running, cur]);

  const [nowKind, nowText] = nowLine();

  // Строка «сейчас»: заголовок и пояснение к текущей фазе.
  function nowLine(): [string, string] {
    if (running) return [`Шаг ${cur + 1} из ${total}`, label(cur)];
    if (error) return [`Ошибка на шаге ${cur + 1}`, label(cur)];
    if (done) return ['Сценарий выполнен', stepsCount(total)];
    if (waiting) {
      const first = `первый шаг: ${label(0)}`;
      return ['Ожидание', countdown ? `старт через ${countdown} с · ${first}` : first];
    }
    return ['Открывается страница', label(0)];
  }

  const showAction = !running && (picked != null || done);
  const actionText =
    picked == null
      ? 'Повторить весь сценарий в этой вкладке'
      : `Шаг ${picked + 1} из ${total} · ${label(picked)}`;

  return (
    <div className={cx('scenario-progress', { done, error })}>
      <div className="scenario-now">
        <span className="scenario-now-k">{nowKind}</span>
        <span className="scenario-now-t">{nowText}</span>
      </div>
      {showAction && (
        <div className="scenario-action" data-mode={picked == null ? 'done' : 'picked'}>
          <span className="scenario-action-t">{actionText}</span>
          <button type="button" className="scenario-run" onClick={onRun}>
            {picked == null ? '▶ Повторить' : '▶ Запустить отсюда'}
          </button>
          {picked != null && (
            <button
              type="button"
              className="scenario-action-x"
              aria-label="Снять выбор"
              onClick={() => onPick(null)}
            >
              ✕
            </button>
          )}
        </div>
      )}
      <div className="scenario-track">
        <i style={{ width: `${Math.min(100, (completed / total) * 100)}%` }} />
      </div>
      <ol className="scenario-chips" ref={listRef} aria-label="Шаги сценария">
        {steps.map((step, i) => (
          <li
            key={i}
            title={`${i + 1}. ${describeStep(step)} — нажми, чтобы повторять с этого шага`}
            className={cx({
              done: i < completed,
              current: running && i === cur,
              failed: error && i === cur,
              picked: picked === i,
            })}
            onClick={() => {
              if (!running) onPick(i);
            }}
          >
            <b>{i + 1}</b>
            <span>{describeStep(step)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
