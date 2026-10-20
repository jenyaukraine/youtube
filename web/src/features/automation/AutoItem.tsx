import type { ReactNode } from 'react';

interface Props {
  name: ReactNode;
  meta: ReactNode;
  /** Кнопки действий. */
  children: ReactNode;
}

/** Строка списка автоматизации: название, моно-описание, кнопки. */
export function AutoItem({ name, meta, children }: Props) {
  return (
    <div className="auto-item">
      <b>{name}</b>
      <span className="auto-meta">{meta}</span>
      <span className="auto-ops">{children}</span>
    </div>
  );
}
