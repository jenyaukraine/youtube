import { useEffect, useState } from 'react';
import type { LiveState } from './types';
import { setJobsForAuth } from './api';

const EMPTY: LiveState = { jobs: [], log: [], system: { cpu_percent: 0, memory_percent: 0, chromium_processes: 0 }, triggers: [] };

/** Живое состояние сервера по WebSocket /ws с переподключением. */
export function useLive(): { state: LiveState; online: boolean } {
  const [state, setState] = useState<LiveState>(EMPTY);
  const [online, setOnline] = useState(false);
  useEffect(() => {
    let ws: WebSocket | null = null, timer: number | undefined, closed = false;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws.onopen = () => setOnline(true);
      ws.onmessage = e => { try { const data = JSON.parse(e.data) as LiveState; setJobsForAuth(data.jobs || []); setState(data); } catch { /* ignore */ } };
      ws.onclose = () => { setOnline(false); if (!closed) timer = window.setTimeout(connect, 2500); };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => { closed = true; window.clearTimeout(timer); ws?.close(); };
  }, []);
  return { state, online };
}
