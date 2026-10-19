import type { Step } from './types';

export interface ChromeTab { id: number; title: string; url: string }
export interface BridgeReply {
  ok: boolean;
  error?: string;
  version?: string;
  tab?: ChromeTab | null;
  tabs?: ChromeTab[];
  recording?: boolean;
  events?: { step: Step; at: number }[] | number;
  image?: string;
  media?: { visibility: string; video: { paused: boolean; currentTime: number; duration: number; readyState: number } | null } | null;
  [key: string]: unknown;
}

const pending = new Map<string, { resolve: (value: BridgeReply) => void; timer: number }>();
window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'katya-extension') return;
  const request = pending.get(event.data.id);
  if (!request) return;
  clearTimeout(request.timer);
  pending.delete(event.data.id);
  request.resolve(event.data.reply);
});

let relayMode: Promise<boolean> | null = null;
function desktopRelay(): Promise<boolean> {
  if (!relayMode) relayMode = fetch('/api/extension/relay-status').then(r => r.ok ? r.json() : null).then(r => !!r?.ok).catch(() => false);
  return relayMode;
}

/** Chrome content script in a browser; local WebSocket relay inside Tauri. */
export async function chromeBridge(command: string, payload: Record<string, unknown> = {}): Promise<BridgeReply> {
  if (await desktopRelay()) {
    try {
      const response = await fetch('/api/extension/command', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({command, payload})});
      return await response.json();
    } catch (error) { return {ok: false, error: `Нет связи с локальным сервером: ${(error as Error).message}`}; }
  }
  return directBridge(command, payload);
}

function directBridge(command: string, payload: Record<string, unknown>): Promise<BridgeReply> {
  return new Promise(resolve => {
    const id = crypto.randomUUID();
    const timeout = command === 'execute' ? 35000 : command === 'screenshot' ? 12000 : 5000;
    const timer = window.setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: 'Расширение не отвечает. Проверьте его в Chrome.' });
    }, timeout);
    pending.set(id, { resolve, timer });
    window.postMessage({ source: 'katya-dashboard', id, command, payload }, location.origin);
  });
}

export function recordedEventsToSteps(events: { step: Step; at: number }[]): Step[] {
  const steps: Step[] = [];
  let previous: number | null = null;
  for (const event of events) {
    if (previous !== null) {
      let gap = Math.max(0, Number(event.at) - previous);
      while (gap >= 350) {
        const part = Math.min(60000, Math.round(gap / 100) * 100);
        steps.push({ action: 'wait', value: String(part) });
        gap -= part;
      }
    }
    steps.push(event.step);
    previous = Number(event.at);
  }
  return steps;
}
