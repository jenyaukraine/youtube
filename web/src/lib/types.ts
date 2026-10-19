// Типы API Katya. Единственный источник правды по схеме шага — katya/actions.py; здесь зеркало для фронтенда.
export type ActionName =
  | 'navigate' | 'reload' | 'back'
  | 'click' | 'wait_click' | 'dblclick' | 'point' | 'move' | 'mouse_drag' | 'inspect'
  | 'fill' | 'type' | 'press' | 'hover' | 'drag' | 'scroll' | 'select'
  | 'wait' | 'wait_for' | 'wait_gone' | 'wait_url'
  | 'text' | 'attribute' | 'exists' | 'count' | 'screenshot' | 'page_text';

export type Kind = 'css' | 'text' | 'role' | 'label' | 'placeholder' | 'xpath';

export interface Step {
  action: ActionName;
  kind?: Kind;
  query?: string;
  role?: string;
  value?: string;
  x?: number;
  y?: number;
  end_x?: number;
  end_y?: number;
  nth?: number;
  timeout_ms?: number;
  optional?: boolean;
  name?: string;
  replace?: boolean;
  duration_ms?: string; // так сервер отдаёт паузу в snapshot сценария
}

export interface ScenarioSettings {
  headers?: Record<string, string>;
  user_agent_mode?: string;
  profile?: string;
}

export interface Scenario {
  id: string;
  name: string;
  startUrl: string;
  steps: Step[];
  settings?: ScenarioSettings;
  variables?: Record<string, string>;
  createdAt: string;
}

export interface Macro {
  name: string;
  steps: Step[];
  description?: string;
  start_url?: string;
  settings?: ScenarioSettings;
}

export interface ScenarioStatus {
  phase?: 'waiting' | 'running' | 'done' | 'error' | '';
  current?: number;
  completed?: number;
  wait_until?: number;
}

export interface Worker {
  id: string;
  url: string;
  user_agent?: string | null;
  profile?: string;
  state: string;
  watch_seconds: number;
  loop: number;
  last_action: string;
  error: string;
  uptime: number;
  triggers_fired?: number;
  scenario?: ScenarioStatus;
}

export interface Job {
  id: string;
  url: string;
  status: 'pending' | 'running' | 'stopped' | 'error';
  workers: number;
  duration: number;
  dialogs?: string;
  total_watch_seconds: number;
  created: number;
  workers_list: Worker[];
  scenario_steps?: Step[];
  control_token?: string;
}

export interface TriggerWhen { kind: Kind | 'url'; query: string; role?: string }
export interface Trigger {
  id: string;
  name: string;
  when: TriggerWhen;
  then: Step[];
  enabled: boolean;
  once_per_page: boolean;
  cooldown_ms: number;
  job_id: string;
  fired: number;
}

export interface SystemMetrics { cpu_percent: number; memory_percent: number; chromium_processes: number }

export interface LiveState {
  jobs: Job[];
  log: string[];
  system: SystemMetrics;
  triggers?: Trigger[];
  runs_recent?: unknown[];
}

export interface ActionResult { ok: boolean; error?: string; url?: string; ms?: number; [k: string]: unknown }
export interface StepsResult { ok: boolean; completed: number; error?: string; results: (ActionResult & { step: string })[] }
export interface FileItem { name: string; size: number; modified: number }
export interface TriggerTestResult {
  ok: boolean; error?: string; url?: string; matches?: boolean; count?: number;
  box?: { x: number; y: number; w: number; h: number } | null;
  run?: StepsResult;
}
