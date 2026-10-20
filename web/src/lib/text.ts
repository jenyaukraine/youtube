/** Русское склонение: plural(3, 'шаг', 'шага', 'шагов') → 'шага'. */
export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

export const stepsCount = (n: number) => `${n} ${plural(n, 'шаг', 'шага', 'шагов')}`;

/** Хост без www или пустая строка, если адрес не разбирается. */
export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export const isHttpUrl = (url: string) => /^https?:\/\/[^\s/]+/i.test(url.trim());

export const clockNow = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

/** 125 → «2:05». */
export function minutesSeconds(seconds: number) {
  const whole = Math.floor(seconds || 0);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const errorText = (error: unknown, fallback = 'Ошибка') =>
  error instanceof Error ? error.message : fallback;
