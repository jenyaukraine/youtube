import { minutesSeconds } from '@/lib/text';
import type { ChromeVideo } from './bridge';

interface Props {
  video: ChromeVideo;
  onAction: (type: string, time?: number) => void;
}

const SKIP_S = 10;

/** Управление видео во вкладке: пауза, перемотка на ±10 с, ползунок и время. */
export function VideoControls({ video, onAction }: Props) {
  const duration = Math.max(1, Math.floor(video.duration || 1));
  const current = Math.floor(video.currentTime || 0);
  const seek = (time: number) => onAction('seek', Math.max(0, time));
  const togglePlay = () => onAction(video.paused ? 'play' : 'pause');

  return (
    <div className="chrome-video" role="group" aria-label="Управление видео">
      <button
        type="button"
        className="btn btn-sm"
        onClick={togglePlay}
        aria-label={video.paused ? 'Играть' : 'Пауза'}
      >
        {video.paused ? '▶' : 'Ⅱ'}
      </button>
      <button type="button" className="btn btn-sm" onClick={() => seek(video.currentTime - SKIP_S)}>
        −10
      </button>
      <input
        type="range"
        min={0}
        max={duration}
        value={current}
        onChange={event => seek(Number(event.target.value))}
        aria-label="Перемотка видео"
      />
      <button type="button" className="btn btn-sm" onClick={() => seek(video.currentTime + SKIP_S)}>
        +10
      </button>
      <span className="mono">
        {minutesSeconds(video.currentTime)} / {minutesSeconds(video.duration)}
      </span>
    </div>
  );
}
