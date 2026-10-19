import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { cx } from '@/lib/cx';
import { clamp } from '@/lib/text';

type InputPayload = Record<string, unknown>;

interface Props {
  /** data:image кадра или пустая строка. */
  frame: string;
  /** Текст, когда кадра нет. */
  empty: string;
  onInput: (payload: InputPayload) => void;
}

const DRAG_MOVE_MS = 24;
const HOVER_MOVE_MS = 60;

/** Точка события в долях кадра 0–1. */
function pointIn(image: HTMLImageElement | null, event: { clientX: number; clientY: number }) {
  const rect = image?.getBoundingClientRect();
  if (!rect) return { x: 0, y: 0 };
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  };
}

function modifiersOf(event: KeyboardEvent) {
  return (
    (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0)
  );
}

/** Живой кадр вкладки: мышь, колесо, клавиатура и вставка уходят в Chrome. */
export function ChromeFrame({ frame, empty, onInput }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const dragging = useRef(false);
  const lastMove = useRef(0);
  const hasFrame = frame !== '';

  // Колесо вешаем нативно: React регистрирует wheel как passive, и preventDefault там не работает.
  useEffect(() => {
    const node = box.current;
    if (!node || !hasFrame) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      onInput({
        type: 'wheel',
        ...pointIn(image.current, event),
        deltaX: event.deltaX,
        deltaY: event.deltaY,
      });
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [hasFrame, onInput]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!hasFrame || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    onInput({ type: 'down', ...pointIn(image.current, event) });
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const throttle = dragging.current ? DRAG_MOVE_MS : HOVER_MOVE_MS;
    if (!hasFrame || Date.now() - lastMove.current < throttle) return;
    lastMove.current = Date.now();
    onInput({ type: 'move', dragging: dragging.current, ...pointIn(image.current, event) });
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    onInput({ type: 'up', ...pointIn(image.current, event) });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!hasFrame) return;
    event.preventDefault();
    const modifiers = modifiersOf(event);
    if (event.key.length === 1 && !modifiers) onInput({ type: 'text', text: event.key });
    else onInput({ type: 'key', key: event.key, code: event.code, modifiers });
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!hasFrame) return;
    event.preventDefault();
    onInput({ type: 'text', text: event.clipboardData.getData('text/plain') });
  };

  return (
    <div
      ref={box}
      className={cx('chrome-frame', { empty: !hasFrame })}
      tabIndex={0}
      role="application"
      aria-label="Живая вкладка Chrome"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
    >
      {hasFrame ? (
        <img ref={image} src={frame} alt="Живая вкладка Chrome" draggable={false} />
      ) : (
        <span className="chrome-frame-empty">{empty}</span>
      )}
    </div>
  );
}
