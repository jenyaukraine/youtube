import { useRef } from 'react';
import type { Recorder } from '@/hooks/useRecorder';
import { cx } from '@/lib/cx';
import type { SourceOption } from '@/lib/sources';
import { clamp } from '@/lib/text';
import { SourceSelect } from '@/ui/SourceSelect';

interface Props {
  recorder: Recorder;
  loadOptions: SourceOption[];
  onToggleRecord: () => void;
  onReplay: () => void;
  onSave: () => void;
  onLoad: (value: string) => void;
}

function replayLabel({ replaying, from }: Recorder) {
  if (replaying) return '■ Остановить';
  if (from > 0) return `▶ С шага ${from + 1}`;
  return '▶ Повторить';
}

/** Кнопки записи, повтора, сохранения и загрузки шагов. */
export function RecorderBar({ recorder, loadOptions, onToggleRecord, onReplay, onSave, onLoad }: Props) {
  const menuRef = useRef<HTMLDetailsElement>(null);

  // Пункт меню выполняется и закрывает меню.
  const menuAction = (run: () => void) => () => {
    run();
    menuRef.current?.removeAttribute('open');
  };

  return (
    <div className="recorder-bar">
      <button
        type="button"
        className={cx('btn recorder-record', { recording: recorder.recording })}
        onClick={onToggleRecord}
      >
        {recorder.recording ? '■ Остановить запись' : '● Записать шаги'}
      </button>

      <div className="recorder-repeat">
        <input
          type="number"
          min={1}
          max={100}
          value={recorder.repeat}
          disabled={recorder.replaying}
          aria-label="Сколько раз повторить"
          onChange={e => recorder.setRepeat(clamp(Number(e.target.value) || 1, 1, 100))}
        />
        <span>раз</span>
        <button
          type="button"
          className={cx('recorder-replay', { running: recorder.replaying })}
          onClick={onReplay}
        >
          {replayLabel(recorder)}
        </button>
      </div>

      <button type="button" className="btn btn-accent recorder-save" onClick={onSave}>
        💾 Сохранить
      </button>

      <SourceSelect
        className="recorder-load"
        value=""
        options={loadOptions}
        placeholder="Открыть сценарий…"
        aria-label="Открыть сценарий"
        onChange={value => {
          if (value) onLoad(value);
        }}
      />

      <details className="recorder-more" ref={menuRef}>
        <summary title="Ещё" aria-label="Ещё действия">
          ⋯
        </summary>
        <div className="recorder-menu">
          <button type="button" onClick={menuAction(recorder.copyJson)}>
            Копировать шаги как JSON
          </button>
          <button type="button" onClick={menuAction(recorder.unpickAll)}>
            Повторять с начала
          </button>
        </div>
      </details>

      <button
        type="button"
        className="btn btn-ghost btn-icon recorder-clear"
        title="Очистить запись"
        aria-label="Очистить запись"
        onClick={recorder.clear}
      >
        🗑
      </button>
    </div>
  );
}
