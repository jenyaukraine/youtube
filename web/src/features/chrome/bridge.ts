import { waitStepsFor } from '@/lib/steps';
import { errorText } from '@/lib/text';
import type { Step } from '@/lib/types';

// Связь с расширением Katya-Browser-Bridge: postMessage через content script в браузере,
// локальный relay сервера внутри Tauri.

export interface ChromeTab {
  id: number;
  title: string;
  url: string;
}

export interface ChromeVideo {
  paused: boolean;
  currentTime: number;
  duration: number;
  readyState: number;
}

export interface ChromeMedia {
  visibility: string;
  video: ChromeVideo | null;
}

export interface RecordedEvent {
  step: Step;
  at: number;
}

export interface BridgeReply {
  ok: boolean;
  error?: string;
  version?: string;
  tab?: ChromeTab | null;
  tabs?: ChromeTab[];
  recording?: boolean;
  events?: RecordedEvent[] | number;
  image?: string;
  media?: ChromeMedia | null;
  [key: string]: unknown;
}

interface PendingRequest {
  resolve: (reply: BridgeReply) => void;
  timer: number;
}

interface ExtensionMessage {
  source?: string;
  id?: string;
  reply?: BridgeReply;
}

const TIMEOUTS: Record<string, number> = { execute: 35000, screenshot: 12000 };
const DEFAULT_TIMEOUT = 5000;

const pending = new Map<string, PendingRequest>();

window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data as ExtensionMessage | null;
  if (data?.source !== 'katya-extension' || !data.id || !data.reply) return;
  const request = pending.get(data.id);
  if (!request) return;
  clearTimeout(request.timer);
  pending.delete(data.id);
  request.resolve(data.reply);
});

let relayMode: Promise<boolean> | null = null;

/** Внутри Tauri команды идут через локальный relay сервера; проверяем один раз. */
function desktopRelay(): Promise<boolean> {
  if (!relayMode) {
    relayMode = fetch('/api/extension/relay-status')
      .then(response => (response.ok ? response.json() : null))
      .then(status => Boolean(status?.ok))
      .catch(() => false);
  }
  return relayMode;
}

export async function chromeBridge(
  command: string,
  payload: Record<string, unknown> = {},
): Promise<BridgeReply> {
  if (await desktopRelay()) return relayBridge(command, payload);
  return directBridge(command, payload);
}

async function relayBridge(command: string, payload: Record<string, unknown>): Promise<BridgeReply> {
  try {
    const response = await fetch('/api/extension/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, payload }),
    });
    return (await response.json()) as BridgeReply;
  } catch (error) {
    return { ok: false, error: `Нет связи с локальным сервером: ${errorText(error)}` };
  }
}

function directBridge(command: string, payload: Record<string, unknown>): Promise<BridgeReply> {
  return new Promise(resolve => {
    const id = crypto.randomUUID();
    const timer = window.setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: 'Расширение не отвечает. Проверьте его в Chrome.' });
    }, TIMEOUTS[command] ?? DEFAULT_TIMEOUT);
    pending.set(id, { resolve, timer });
    window.postMessage({ source: 'katya-dashboard', id, command, payload }, location.origin);
  });
}

/** События записи → шаги; промежутки между событиями становятся паузами. */
export function recordedEventsToSteps(events: RecordedEvent[]): Step[] {
  const steps: Step[] = [];
  let previous: number | null = null;
  for (const event of events) {
    const at = Number(event.at);
    if (previous !== null) steps.push(...waitStepsFor(at - previous));
    steps.push(event.step);
    previous = at;
  }
  return steps;
}
