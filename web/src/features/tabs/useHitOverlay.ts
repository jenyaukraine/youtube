import { useEffect, useState, type CSSProperties, type RefObject } from 'react';
import type { Box } from '@/lib/types';

interface HitDetail {
  job: string;
  worker: string;
  box: Box | null;
}

const SHOW_MS = 4000;
const MIN_PX = 6;

/** Рамка элемента в пикселях бокса — по текущей геометрии кадра (картинка лежит в боксе по центру, без полей). */
function hitStyle(img: HTMLImageElement | null, box: HTMLDivElement | null, hit: Box): CSSProperties | null {
  if (!img || !box) return null;
  const image = img.getBoundingClientRect();
  const frame = box.getBoundingClientRect();
  if (!image.width || !image.height) return null;
  return {
    left: image.left - frame.left - box.clientLeft + hit.x * image.width,
    top: image.top - frame.top - box.clientTop + hit.y * image.height,
    width: Math.max(MIN_PX, hit.w * image.width),
    height: Math.max(MIN_PX, hit.h * image.height),
  };
}

/** Подсветка найденного элемента на 4 с: событие `katya-hit` шлёт проверка триггера из раздела автоматизации. */
export function useHitOverlay(
  job: string,
  worker: string,
  imgRef: RefObject<HTMLImageElement>,
  boxRef: RefObject<HTMLDivElement>,
) {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    const onHit = (event: Event) => {
      const detail = (event as CustomEvent<HitDetail | undefined>).detail;
      if (!detail?.box || detail.job !== job || detail.worker !== worker) return;
      setStyle(hitStyle(imgRef.current, boxRef.current, detail.box));
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setStyle(null), SHOW_MS);
    };
    window.addEventListener('katya-hit', onHit);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('katya-hit', onHit);
    };
  }, [job, worker, imgRef, boxRef]);

  return style;
}
