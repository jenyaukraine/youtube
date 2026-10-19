import { ScenarioPanel } from '@/features/scenario/ScenarioPanel';
import { ScenariosPage } from '@/features/scenarios/ScenariosPage';
import type { Library } from '@/hooks/useLibrary';
import { libraryCount, sourceOptions } from '@/lib/sources';
import type { LaunchMode } from '@/lib/storage';
import { stepsCount } from '@/lib/text';
import { ChromeControlCard } from './ChromeControlCard';
import { ChromeFrame } from './ChromeFrame';
import { useChromeScenario } from './useChromeScenario';
import { VideoControls } from './VideoControls';
import './chrome.css';

interface Props {
  library: Library;
  mode: LaunchMode;
  onMode: (mode: LaunchMode) => void;
}

/** Режим «Мой Chrome»: вкладкой установленного Chrome управляет расширение Katya-Browser-Bridge. */
export function ChromeWorkspace({ library, mode, onMode }: Props) {
  const scenario = useChromeScenario(library);
  const { chrome, recorder } = scenario;
  const { video, visibility } = chrome.media;
  const playerHidden = visibility === 'hidden' && video !== null && !video.paused;
  const statusLine = scenario.waitLeft
    ? `Пауза · осталось ${(scenario.waitLeft / 1000).toFixed(1)} с`
    : scenario.message;
  const emptyText = scenario.message || chrome.frameError || 'Откройте или подключите вкладку Chrome';
  const tabTitle = chrome.tab ? chrome.tab.title || 'Живая вкладка' : 'Нет подключённой вкладки';

  return (
    <div className="grid">
      <ChromeControlCard scenario={scenario} library={library} mode={mode} onMode={onMode} />

      <div className="card chrome-workspace">
        <h2>Вкладка Chrome</h2>

        <details className="fold chrome-library">
          <summary>Сохранённые сценарии · {libraryCount(library.scenarios, library.macros)}</summary>
          <ScenariosPage library={library} />
        </details>

        <div className="chrome-toolbar">
          <span className="chrome-tab-title" title={chrome.tab?.url}>
            {tabTitle}
          </span>
          {chrome.tab && (
            <button type="button" className="btn btn-sm" onClick={chrome.detach}>
              Отключить
            </button>
          )}
        </div>

        {playerHidden && (
          <div className="note info chrome-hidden">
            <span>Вкладка скрыта — плеер может ждать активации</span>
            <button type="button" className="btn btn-sm btn-accent" onClick={chrome.promote}>
              Открыть отдельно
            </button>
          </div>
        )}

        <ChromeFrame frame={chrome.frame} empty={emptyText} onInput={chrome.input} />
        {video && <VideoControls video={video} onAction={chrome.videoAction} />}

        <div className="chrome-status" aria-live="polite">
          {statusLine}
        </div>

        <ScenarioPanel
          progress={{
            steps: recorder.steps,
            status: scenario.phase,
            clientRun: scenario.clientRun,
            picked: scenario.chip,
            onPick: scenario.pickChip,
            onRun: scenario.runFromChip,
          }}
          recorder={recorder}
          statusText={
            recorder.recording
              ? '● Запись идёт · действия и паузы сохраняются'
              : stepsCount(recorder.steps.length)
          }
          loadOptions={sourceOptions(library.scenarios, library.macros)}
          onToggleRecord={scenario.toggleRecord}
          onReplay={scenario.replay}
          onSave={scenario.save}
          onLoad={scenario.load}
          onManual={scenario.manual}
        />
      </div>
    </div>
  );
}
