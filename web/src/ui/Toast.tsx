import { useEffect, useRef, useState } from 'react';
import { cx } from '@/lib/cx';
import { onToast, type ToastMessage } from '@/lib/toast';
import './ui.css';

/** Единственный способ сообщить результат действия. Монтируется один раз в App. */
export function Toast() {
  const [current, setCurrent] = useState<ToastMessage | null>(null);
  const timer = useRef<number>();

  useEffect(
    () =>
      onToast(message => {
        setCurrent(message);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCurrent(null), 3200);
      }),
    [],
  );

  return (
    <div className={cx('toast', current && 'show', current?.type)} role="status">
      {current?.msg}
    </div>
  );
}
