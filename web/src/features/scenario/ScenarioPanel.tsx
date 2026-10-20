import { cx } from '@/lib/cx';
import { ManualAction } from './ManualAction';
import { statusLine } from './progressState';
import { RecorderBar } from './RecorderBar';
import { ScenarioProgress } from './ScenarioProgress';
import { StepList } from './StepList';
import type { ScenarioPanelProps } from './types';
import './scenario.css';

/** Универсальная панель «Сценарий»: прогресс сервера, запись, список шагов, ручное действие. */
export function ScenarioPanel(props: ScenarioPanelProps) {
  const { progress, recorder, statusText, loadOptions, onToggleRecord, onReplay, onSave, onLoad, onManual } =
    props;

  return (
    <section className="scenario-panel">
      <header className="scenario-head">
        <h3>Сценарий</h3>
        <span className="scenario-head-status">{statusLine(progress)}</span>
      </header>

      {progress.steps.length > 0 && <ScenarioProgress {...progress} />}

      <RecorderBar
        recorder={recorder}
        loadOptions={loadOptions}
        onToggleRecord={onToggleRecord}
        onReplay={onReplay}
        onSave={onSave}
        onLoad={onLoad}
      />

      <p
        className={cx('scenario-status', { running: recorder.replaying || recorder.recording })}
        aria-live="polite"
      >
        {statusText}
      </p>

      <StepList recorder={recorder} />

      <ManualAction onSubmit={onManual} />
    </section>
  );
}
