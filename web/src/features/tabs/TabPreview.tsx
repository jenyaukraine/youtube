import { useRef } from 'react';
import { useFrameInput } from './useFrameInput';
import { useHitOverlay } from './useHitOverlay';
import type { Act } from './useTabScenario';

interface Props {
  job: string;
  worker: string;
  frame: string;
  frameAt: string;
  owned: boolean;
  act: Act;
}

const HINT_OWNED = 'Клик — ввод · мышь — выделение · колесо — прокрутка · печатай с клавиатуры';
const HINT_VIEW = 'Вкладка открыта из другой панели: только просмотр';

/** Живой кадр вкладки с управлением мышью и клавиатурой. */
export function TabPreview({ job, worker, frame, frameAt, owned, act }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const input = useFrameInput(act, imgRef, boxRef);
  const hit = useHitOverlay(job, worker, imgRef, boxRef);

  return (
    <div
      className="preview"
      ref={boxRef}
      tabIndex={0}
      aria-label="Кадр вкладки"
      onKeyDown={input.onKeyDown}
      onPaste={input.onPaste}
    >
      {frame ? (
        <img
          ref={imgRef}
          src={frame}
          alt="Снимок вкладки — нажми, выдели или прокрути"
          draggable={false}
          onPointerDown={input.onPointerDown}
          onPointerUp={input.onPointerUp}
          onPointerMove={input.onPointerMove}
        />
      ) : (
        <span className="preview-note">Ожидаю кадр…</span>
      )}
      {hit && <div className="preview-hit" style={hit} />}
      <span className="preview-hint">{owned ? HINT_OWNED : HINT_VIEW}</span>
      <span className="preview-time">{frame ? `● Live ${frameAt}` : 'Ожидаю кадр…'}</span>
    </div>
  );
}
