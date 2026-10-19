import type { Recorder } from '@/hooks/useRecorder';
import type { SourceOption } from '@/lib/sources';
import type { ScenarioStatus, Step } from '@/lib/types';

/** Прогресс повтора на клиенте (когда шаги гоняет сама панель, а не сервер). */
export interface ClientRun {
  index: number;
  total: number;
}

/** Прогресс сценария, с которым открыли вкладку: фишки шагов, строка «сейчас», запуск с выбранного шага. */
export interface ScenarioProgressProps {
  steps: Step[];
  status: ScenarioStatus;
  clientRun: ClientRun | null;
  /** Выбранная фишка (с какого шага повторять) или null. */
  picked: number | null;
  onPick: (index: number | null) => void;
  /** Повторить с выбранной фишки или весь сценарий, если ничего не выбрано. */
  onRun: () => void;
}

/** Универсальная панель «Сценарий»: прогресс + запись + список шагов + ручное действие. Одна на все экраны. */
export interface ScenarioPanelProps {
  progress: ScenarioProgressProps;
  recorder: Recorder;
  statusText: string;
  loadOptions: SourceOption[];
  onToggleRecord: () => void;
  /** Повторить запись; во время повтора — остановить. */
  onReplay: () => void;
  onSave: () => void;
  onLoad: (value: string) => void;
  onManual: (step: Step) => void;
}
