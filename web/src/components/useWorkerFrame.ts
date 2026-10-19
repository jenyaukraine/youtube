import { useCallback, useEffect, useRef, useState } from 'react';
import { screenshotUrl } from '../lib/api';

/** Polls only while the card is visible; keeps one screenshot request in flight. */
export function useWorkerFrame(jobId: string, workerId: string, collapsed: boolean, active: boolean) {
  const cardRef = useRef<HTMLDivElement>(null);
  const touchedAt = useRef(0);
  const activeRef = useRef(active);
  const requestRef = useRef<() => void>(() => {});
  const [frame, setFrame] = useState('');
  const [frameAt, setFrameAt] = useState('');
  activeRef.current = active;

  const requestFrame = useCallback(() => requestRef.current(), []);

  useEffect(() => {
    let busy = false, stopped = false, visible = false, urgent = false;
    let timer: number | undefined;
    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      if (!stopped) timer = window.setTimeout(tick, delay);
    };
    const tick = async () => {
      if (stopped) return;
      if (document.hidden || !visible) { schedule(800); return; }
      if (busy) { urgent = true; return; }
      busy = true;
      const url = screenshotUrl(jobId, workerId, !collapsed);
      await new Promise<void>(resolve => {
        const image = new Image();
        image.onload = () => {
          if (!stopped) { setFrame(url); setFrameAt(new Date().toLocaleTimeString('ru-RU')); }
          resolve();
        };
        image.onerror = () => resolve();
        image.src = url;
      });
      busy = false;
      const recent = activeRef.current || Date.now() - touchedAt.current < 5000;
      schedule(urgent ? 180 : collapsed ? 30000 : recent ? 280 : 1200);
      urgent = false;
    };
    requestRef.current = () => {
      touchedAt.current = Date.now();
      if (busy) urgent = true;
      else schedule(0);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) schedule(0);
    }, { rootMargin: '150px' });
    if (cardRef.current) observer.observe(cardRef.current);
    const onVisibility = () => { if (!document.hidden && visible) schedule(0); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      requestRef.current = () => {};
    };
  }, [jobId, workerId, collapsed]);

  return { cardRef, frame, frameAt, touchedAt, requestFrame };
}
