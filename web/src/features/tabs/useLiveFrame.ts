import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { screenshotUrl } from '@/api/tabs';

interface Options {
  job: string;
  worker: string;
  collapsed: boolean;
  /** Идёт запись, повтор или серверный сценарий — кадры нужны чаще. */
  active: boolean;
  /** Карточка: кадры запрашиваются, только пока она на экране. */
  cardRef: RefObject<HTMLElement>;
}

const HIDDEN_MS = 800;
const URGENT_MS = 180;
const ACTIVE_MS = 280;
const CALM_MS = 1200;
const COLLAPSED_MS = 8000;
/** Сколько после последнего действия кадры идут в быстром темпе. */
const RECENT_MS = 5000;

const loadImage = (url: string) =>
  new Promise<boolean>(resolve => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = url;
  });

/** Живой кадр вкладки: один запрос за раз, пауза вне экрана и в скрытой вкладке, быстрый отклик после действий. */
export function useLiveFrame({ job, worker, collapsed, active, cardRef }: Options) {
  const [frame, setFrame] = useState('');
  const [frameAt, setFrameAt] = useState('');
  const activeRef = useRef(active);
  const touchedAt = useRef(0);
  const request = useRef<() => void>(() => {});

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    let busy = false;
    let stopped = false;
    let visible = false;
    let urgent = false;
    let timer: number | undefined;

    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      if (!stopped) timer = window.setTimeout(tick, delay);
    };

    async function tick() {
      if (stopped) return;
      if (document.hidden || !visible) {
        schedule(HIDDEN_MS);
        return;
      }
      if (busy) {
        urgent = true;
        return;
      }
      busy = true;
      const url = screenshotUrl(job, worker);
      const loaded = await loadImage(url);
      busy = false;
      if (stopped) return;
      if (loaded) {
        setFrame(url);
        setFrameAt(new Date().toLocaleTimeString('ru-RU'));
      }
      const recent = activeRef.current || Date.now() - touchedAt.current < RECENT_MS;
      schedule(urgent ? URGENT_MS : collapsed ? COLLAPSED_MS : recent ? ACTIVE_MS : CALM_MS);
      urgent = false;
    }

    request.current = () => {
      touchedAt.current = Date.now();
      if (busy) urgent = true;
      else schedule(0);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) schedule(0);
      },
      { rootMargin: '150px' },
    );
    if (cardRef.current) observer.observe(cardRef.current);

    const onVisibility = () => {
      if (!document.hidden && visible) schedule(0);
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      request.current = () => {};
    };
  }, [job, worker, collapsed, cardRef]);

  const requestFrame = useCallback(() => request.current(), []);

  return { frame, frameAt, requestFrame };
}
