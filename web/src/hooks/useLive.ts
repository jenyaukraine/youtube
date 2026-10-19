import { useEffect, useState } from 'react';
import { setLiveJobs } from '@/api/client';
import type { LiveState } from '@/lib/types';

const EMPTY: LiveState = {
  jobs: [],
  log: [],
  system: { cpu_percent: 0, memory_percent: 0, chromium_processes: 0 },
  triggers: [],
};

/** Живое состояние сервера по WebSocket /ws с переподключением. */
export function useLive() {
  const [state, setState] = useState<LiveState>(EMPTY);
  const [online, setOnline] = useState(false);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: number | undefined;
    let closed = false;

    const connect = () => {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      socket.onopen = () => setOnline(true);
      socket.onmessage = event => {
        try {
          const data = JSON.parse(event.data) as LiveState;
          setLiveJobs(data.jobs || []);
          setState(data);
        } catch {
          /* битое сообщение */
        }
      };
      socket.onclose = () => {
        setOnline(false);
        if (!closed) timer = window.setTimeout(connect, 2500);
      };
      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      socket?.close();
    };
  }, []);

  return { state, online };
}
