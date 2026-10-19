import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { reloadWorker, stopWorker } from '@/api/tabs';
import { ScenarioPanel } from '@/features/scenario/ScenarioPanel';
import type { Library } from '@/hooks/useLibrary';
import { cx } from '@/lib/cx';
import { controlToken } from '@/lib/storage';
import { hostOf, isHttpUrl } from '@/lib/text';
import { toastResult } from '@/lib/toast';
import type { Job, Worker } from '@/lib/types';
import { TabPreview } from './TabPreview';
import { useLiveFrame } from './useLiveFrame';
import { useTabScenario } from './useTabScenario';
import './tabs.css';

interface Props {
  job: Job;
  worker: Worker;
  library: Library;
}

/** Карточка вкладки: плитка, живой кадр с управлением, состояние, адрес и панель сценария. */
export function TabCard({ job, worker, library }: Props) {
  const [collapsed, setCollapsed] = useState(true);
  const [urlDraft, setUrlDraft] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const owned = Boolean(controlToken(job.id));
  const url = worker.url || job.url;
  const shortId = worker.id.split('-').pop();
  const state = worker.last_action || worker.state;

  // Кадр и сценарий нужны друг другу: запрос кадра идёт через ref, чтобы не было цикла между хуками.
  const frameRequest = useRef<() => void>(() => {});
  const requestFrame = useCallback(() => frameRequest.current(), []);
  const scenario = useTabScenario({ job, worker, library, requestFrame });
  const live = useLiveFrame({ job: job.id, worker: worker.id, collapsed, active: scenario.active, cardRef });

  useEffect(() => {
    frameRequest.current = live.requestFrame;
  }, [live.requestFrame]);

  const toggle = () => {
    setCollapsed(value => !value);
    live.requestFrame();
  };

  const reload = async () => {
    const result = await reloadWorker(job.id, worker.id);
    live.requestFrame();
    toastResult(result, 'Вкладка перезагружена');
  };

  const submitUrl = () => {
    const value = (urlDraft || '').trim();
    setUrlDraft(null);
    if (!value || value === worker.url) return;
    void scenario.act({ action: 'navigate', value: isHttpUrl(value) ? value : `https://${value}` });
  };

  const onUrlKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') submitUrl();
    if (event.key === 'Escape') setUrlDraft(null);
  };

  return (
    <div className={cx('tab', collapsed && 'tab-collapsed')} ref={cardRef} data-id={worker.id}>
      <button
        type="button"
        className="tab-tile"
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Развернуть вкладку' : 'Свернуть вкладку'}
        onClick={toggle}
      >
        <span className="tab-tile-shot">
          {live.frame ? <img src={live.frame} alt="" /> : <span>Ожидаю кадр…</span>}
        </span>
        <span className="tab-tile-info">
          <strong>{hostOf(url) || `W-${shortId}`}</strong>
          <small>{url}</small>
          <span className="tab-tile-state">{state}</span>
        </span>
        <span className="tab-tile-chevron" aria-hidden="true">
          ⌄
        </span>
      </button>

      <TabPreview
        job={job.id}
        worker={worker.id}
        frame={live.frame}
        frameAt={live.frameAt}
        owned={owned}
        act={scenario.act}
      />

      <div className="tab-meta">
        <span className={cx('dot', worker.state)} />
        <b>W-{shortId}</b>
        <span className="tab-meta-action">{state}</span>
        <span className="tab-meta-hours">{(worker.watch_seconds / 3600).toFixed(3)} ч</span>
      </div>

      <div className="btn-row tab-actions">
        <button type="button" className="btn btn-sm" onClick={reload}>
          Перезагрузить вкладку
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => void stopWorker(job.id, worker.id)}
        >
          Закрыть
        </button>
      </div>

      {urlDraft == null ? (
        <button
          type="button"
          className="tab-url"
          title={owned ? 'Нажми, чтобы изменить адрес вкладки' : undefined}
          disabled={!owned}
          onClick={() => setUrlDraft(url)}
        >
          {url}
        </button>
      ) : (
        <input
          className="tab-url-edit"
          type="url"
          autoFocus
          value={urlDraft}
          onChange={event => setUrlDraft(event.target.value)}
          onBlur={() => setUrlDraft(null)}
          onKeyDown={onUrlKey}
        />
      )}

      <ScenarioPanel {...scenario.panel} />
    </div>
  );
}
