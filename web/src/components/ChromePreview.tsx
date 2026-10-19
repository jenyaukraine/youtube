import { useRef, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { chromeBridge } from '../lib/chromeBridge';
import { toast } from '../lib/api';
import type { VideoState } from './useChromeWorkspace';

interface Props {
  frame: string;
  message: string;
  video: VideoState | null;
  onActivity: () => void;
  onVideoAction: (type: string, time?: number) => void;
}

const time = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;

/** The screenshot is an input surface; commands are serialized to preserve key and pointer order. */
export function ChromePreview({ frame, message, video, onActivity, onVideoAction }: Props) {
  const image = useRef<HTMLImageElement>(null);
  const queue = useRef(Promise.resolve());
  const dragging = useRef(false);
  const lastMove = useRef(0);
  const point = (event: { clientX: number; clientY: number }) => {
    const rect = image.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  };
  const input = (payload: Record<string, unknown>) => {
    queue.current = queue.current.then(async () => {
      const result = await chromeBridge('input', payload);
      if (!result.ok) throw new Error(result.error || 'Нет ответа от вкладки');
      onActivity();
    }).catch(error => toast(error.message, 'err'));
  };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!frame || event.button !== 0) return;
    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true; input({ type: 'down', ...point(event) });
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!frame || Date.now() - lastMove.current < (dragging.current ? 24 : 60)) return;
    lastMove.current = Date.now(); input({ type: 'move', dragging: dragging.current, ...point(event) });
  };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false; input({ type: 'up', ...point(event) });
  };
  const wheel = (event: WheelEvent<HTMLDivElement>) => {
    if (frame) { event.preventDefault(); input({ type: 'wheel', ...point(event), deltaX: event.deltaX, deltaY: event.deltaY }); }
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!frame) return;
    event.preventDefault();
    const modifiers = (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
    input(event.key.length === 1 && !modifiers ? { type: 'text', text: event.key } : { type: 'key', key: event.key, code: event.code, modifiers });
  };

  return <>
    <div className={'chrome-shot' + (frame ? '' : ' empty')} id="chromeShotFrame" tabIndex={0}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onWheel={wheel} onKeyDown={keyDown}
      onPaste={event => { event.preventDefault(); input({ type: 'text', text: event.clipboardData.getData('text/plain') }); }}>
      {frame ? <img ref={image} src={frame} alt="Живая вкладка Chrome" draggable={false} /> : <span id="chromeShotEmpty">{message || 'Откройте или подключите вкладку Chrome'}</span>}
    </div>
    {video && <div className="chrome-video-controls">
      <button type="button" onClick={() => onVideoAction(video.paused ? 'play' : 'pause')}>{video.paused ? '▶' : 'Ⅱ'}</button>
      <button type="button" onClick={() => onVideoAction('seek', Math.max(0, video.currentTime - 10))}>−10</button>
      <input type="range" min={0} max={Math.max(1, Math.floor(video.duration || 1))} value={Math.floor(video.currentTime || 0)} onChange={event => onVideoAction('seek', Number(event.target.value))} aria-label="Перемотка видео" />
      <button type="button" onClick={() => onVideoAction('seek', video.currentTime + 10)}>+10</button><span>{time(video.currentTime)} / {time(video.duration)}</span>
    </div>}
  </>;
}
