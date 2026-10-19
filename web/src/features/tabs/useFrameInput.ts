import type { ClipboardEvent, KeyboardEvent, PointerEvent, RefObject } from 'react';
import { useEffect, useRef } from 'react';
import { clamp } from '@/lib/text';
import type { Act } from './useTabScenario';

interface Point {
  x: number;
  y: number;
}

interface DragStart extends Point {
  clientX: number;
  clientY: number;
}

export interface FrameHandlers {
  onPointerDown: (event: PointerEvent<HTMLImageElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLImageElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLImageElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
}

const DRAG_PX = 8;
const MOVE_MS = 150;
const WHEEL_MS = 120;
const TYPE_MS = 150;
const SCROLL_MAX = 3000;
const PASTE_MAX = 2048;
const QUIET = { quiet: true };
const SPECIAL_KEYS = new Set(
  'Backspace Delete Enter Tab ArrowUp ArrowDown ArrowLeft ArrowRight Home End PageUp PageDown Escape'.split(
    ' ',
  ),
);

/** Точка курсора в долях кадра (0..1) или null, если курсор вне картинки. */
function pointOn(img: HTMLImageElement | null, clientX: number, clientY: number): Point | null {
  if (!img) return null;
  const rect = img.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

/** Мышь, колесо, клавиатура и вставка над кадром → действия во вкладке. */
export function useFrameInput(
  act: Act,
  imgRef: RefObject<HTMLImageElement>,
  boxRef: RefObject<HTMLDivElement>,
): FrameHandlers {
  const actRef = useRef(act);
  const dragStart = useRef<DragStart | null>(null);
  const movePending = useRef<Point | null>(null);
  const moveTimer = useRef<number>();
  const wheelAcc = useRef(0);
  const wheelTimer = useRef<number>();
  const textBuf = useRef('');
  const textTimer = useRef<number>();

  useEffect(() => {
    actRef.current = act;
  }, [act]);

  // Колесо ловим не-пассивно, чтобы страница панели не прокручивалась вместе с кадром.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (event: WheelEvent) => {
      const at = pointOn(imgRef.current, event.clientX, event.clientY);
      if (!at) return;
      event.preventDefault();
      wheelAcc.current += event.deltaY;
      window.clearTimeout(wheelTimer.current);
      wheelTimer.current = window.setTimeout(() => {
        const delta = clamp(Math.round(wheelAcc.current), -SCROLL_MAX, SCROLL_MAX);
        wheelAcc.current = 0;
        if (delta) void actRef.current({ action: 'scroll', value: String(delta), ...at }, QUIET);
      }, WHEEL_MS);
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, [imgRef, boxRef]);

  useEffect(
    () => () => {
      window.clearTimeout(moveTimer.current);
      window.clearTimeout(wheelTimer.current);
      window.clearTimeout(textTimer.current);
    },
    [],
  );

  const point = (event: { clientX: number; clientY: number }) =>
    pointOn(imgRef.current, event.clientX, event.clientY);

  const flushText = () => {
    const text = textBuf.current;
    textBuf.current = '';
    if (text) void actRef.current({ action: 'type', value: text }, QUIET);
  };

  const onPointerDown = (event: PointerEvent<HTMLImageElement>) => {
    const start = point(event);
    if (start) dragStart.current = { ...start, clientX: event.clientX, clientY: event.clientY };
    boxRef.current?.focus({ preventScroll: true });
  };

  const onPointerUp = (event: PointerEvent<HTMLImageElement>) => {
    const start = dragStart.current;
    dragStart.current = null;
    const end = point(event);
    if (!end) return;
    if (start && Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) >= DRAG_PX) {
      void act({ action: 'mouse_drag', x: start.x, y: start.y, end_x: end.x, end_y: end.y }, QUIET);
      return;
    }
    void act({ action: 'point', ...end }, QUIET);
  };

  // Наведение — только курсор во вкладке, в запись не попадает.
  const onPointerMove = (event: PointerEvent<HTMLImageElement>) => {
    if (event.buttons) return;
    const at = point(event);
    if (!at) return;
    movePending.current = at;
    if (moveTimer.current) return;
    moveTimer.current = window.setTimeout(() => {
      moveTimer.current = undefined;
      const target = movePending.current;
      movePending.current = null;
      if (target) void actRef.current({ action: 'move', ...target }, { quiet: true, record: false });
    }, MOVE_MS);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (printable) {
      event.preventDefault();
      textBuf.current += event.key;
      window.clearTimeout(textTimer.current);
      textTimer.current = window.setTimeout(flushText, TYPE_MS);
      return;
    }
    const selectAll = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a';
    if (!selectAll && !SPECIAL_KEYS.has(event.key)) return;
    event.preventDefault();
    flushText();
    void act({ action: 'press', value: selectAll ? 'ControlOrMeta+A' : event.key }, QUIET);
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const text = event.clipboardData.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    void act({ action: 'type', value: text.slice(0, PASTE_MAX) }, QUIET);
  };

  return { onPointerDown, onPointerUp, onPointerMove, onKeyDown, onPaste };
}
