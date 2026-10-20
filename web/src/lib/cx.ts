/** Склейка классов: cx('a', cond && 'b', { c: flag }) → 'a b c'. */
export function cx(...parts: (string | false | null | undefined | Record<string, boolean | undefined>)[]) {
  const out: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (typeof part === 'string') out.push(part);
    else for (const [name, on] of Object.entries(part)) if (on) out.push(name);
  }
  return out.join(' ');
}
