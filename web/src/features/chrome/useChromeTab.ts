import { useCallback, useEffect, useRef, useState } from 'react';
import type { Recorder } from '@/hooks/useRecorder';
import { errorText } from '@/lib/text';
import { toast } from '@/lib/toast';
import type { Step } from '@/lib/types';
import { chromeBridge, type BridgeReply, type ChromeMedia, type ChromeTab } from './bridge';
import { restoreExtensionDirectory } from './updater';

export const REQUIRED_VERSION = '0.6.1';
const KEEP_VISIBLE_EVERY_MS = 10000;

const STATUS_EVERY_MS = 4000;
const FRAME_FAST_MS = 350;
const FRAME_SLOW_MS = 1200;
/** После действия пользователя кадры какое-то время идут чаще. */
const ACTIVITY_WINDOW_MS = 5000;
const NO_MEDIA: ChromeMedia = { visibility: '', video: null };

interface Status {
  connected: boolean;
  version: string;
  tab: ChromeTab | null;
}

export interface ChromeTabApi extends Status {
  /** Расширение найдено и его версия подходит. */
  ready: boolean;
  frame: string;
  frameError: string;
  media: ChromeMedia;
  refreshStatus: () => Promise<void>;
  shot: () => Promise<void>;
  open: (url: string) => Promise<void>;
  attach: (tabId: number) => Promise<void>;
  detach: () => Promise<void>;
  promote: () => Promise<void>;
  listTabs: () => Promise<ChromeTab[]>;
  /** Событие мыши или клавиатуры; уходят во вкладку строго по очереди. */
  input: (payload: Record<string, unknown>) => void;
  execute: (step: Step) => Promise<BridgeReply>;
  videoAction: (type: string, time?: number) => Promise<void>;
}

/** Подключённая вкладка Chrome: состояние расширения, живой кадр, медиа и отправка действий. */
export function useChromeTab(recorder: Recorder): ChromeTabApi {
  const { recording, replaying, setRecording } = recorder;
  const [status, setStatus] = useState<Status>({ connected: false, version: '', tab: null });
  const [frame, setFrame] = useState('');
  const [frameError, setFrameError] = useState('');
  const [media, setMedia] = useState<ChromeMedia>(NO_MEDIA);
  const tabRef = useRef<ChromeTab | null>(null);
  const shotBusy = useRef(false);
  const lastActivity = useRef(0);
  const keepVisibleAt = useRef(0);
  const queue = useRef(Promise.resolve());

  const refreshStatus = useCallback(async () => {
    const reply = await chromeBridge('status');
    const tab = reply.version === REQUIRED_VERSION ? reply.tab || null : null;
    tabRef.current = tab;
    setStatus({ connected: reply.ok, version: reply.version || '', tab });
    setRecording(Boolean(reply.recording));
    if (!tab) {
      setFrame('');
      setMedia(NO_MEDIA);
    }
  }, [setRecording]);

  useEffect(() => {
    restoreExtensionDirectory().then(refreshStatus);
    const timer = window.setInterval(refreshStatus, STATUS_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [refreshStatus]);

  const shot = useCallback(async () => {
    if (!tabRef.current || document.hidden || shotBusy.current) return;
    shotBusy.current = true;
    try {
      const reply = await chromeBridge('screenshot');
      if (reply.ok && reply.image) {
        setFrame(reply.image);
        setFrameError('');
      } else {
        setFrameError(reply.error || 'Кадр недоступен');
      }
    } finally {
      shotBusy.current = false;
    }
  }, []);

  const tabId = status.tab?.id;
  useEffect(() => {
    if (!tabId) return;
    let alive = true;
    let timer = 0;
    const tick = () => {
      if (!document.hidden) {
        shot();
        chromeBridge('media').then(reply => {
          if (!alive) return;
          setMedia(reply.media || NO_MEDIA);
          // Скрытую вкладку Chrome просим эмулировать фокус, чтобы плеер не останавливался.
          if (
            reply.media?.visibility === 'hidden' &&
            Date.now() - keepVisibleAt.current > KEEP_VISIBLE_EVERY_MS
          ) {
            keepVisibleAt.current = Date.now();
            chromeBridge('keep-visible');
          }
        });
      }
      const fast = recording || replaying || Date.now() - lastActivity.current < ACTIVITY_WINDOW_MS;
      timer = window.setTimeout(tick, fast ? FRAME_FAST_MS : FRAME_SLOW_MS);
    };
    tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [tabId, recording, replaying, shot]);

  const touch = useCallback(() => {
    lastActivity.current = Date.now();
    shot();
  }, [shot]);

  const input = useCallback(
    (payload: Record<string, unknown>) => {
      queue.current = queue.current
        .then(async () => {
          const reply = await chromeBridge('input', payload);
          if (!reply.ok) throw new Error(reply.error || 'Нет ответа от вкладки');
          touch();
        })
        .catch(error => toast(errorText(error), 'err'));
    },
    [touch],
  );

  const execute = async (step: Step) => {
    const reply = await chromeBridge('execute', { step });
    touch();
    return reply;
  };

  const videoAction = async (type: string, time?: number) => {
    const reply = await chromeBridge('media-action', { type, time });
    if (!reply.ok) toast(reply.error || 'Видео не ответило', 'err');
    const state = await chromeBridge('media');
    setMedia(state.media || NO_MEDIA);
    shot();
  };

  const open = async (url: string) => {
    const reply = await chromeBridge('open', { url });
    if (!reply.ok) throw new Error(reply.error || 'Не удалось открыть Chrome');
    const tab = reply.tab || null;
    tabRef.current = tab;
    setStatus(prev => ({ ...prev, tab }));
  };

  const attach = async (id: number) => {
    const reply = await chromeBridge('attach', { tabId: id });
    if (reply.ok) await refreshStatus();
    else toast(reply.error || 'Не удалось подключить', 'err');
  };

  const detach = () => chromeBridge('detach').then(refreshStatus);
  const promote = () => chromeBridge('promote').then(refreshStatus);
  const listTabs = async () => (await chromeBridge('tabs')).tabs || [];

  return {
    ...status,
    ready: status.connected && status.version === REQUIRED_VERSION,
    frame,
    frameError,
    media,
    refreshStatus,
    shot,
    open,
    attach,
    detach,
    promote,
    listTabs,
    input,
    execute,
    videoAction,
  };
}
