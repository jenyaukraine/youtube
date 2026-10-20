import { cx } from '@/lib/cx';
import type { LaunchMode } from '@/lib/storage';
import './ui.css';

interface Props {
  value: LaunchMode;
  onChange: (mode: LaunchMode) => void;
}

const MODES: { value: LaunchMode; icon: string; title: string; note: string }[] = [
  { value: 'playwright', icon: '◈', title: 'Playwright', note: 'На сервере' },
  { value: 'chrome', icon: '◎', title: 'Мой Chrome', note: 'Через расширение' },
];

/** Переключатель способа запуска: вкладки на сервере или свой Chrome через расширение. */
export function MethodSwitch({ value, onChange }: Props) {
  return (
    <div className="method-switch" role="group" aria-label="Способ запуска">
      {MODES.map(mode => (
        <button
          key={mode.value}
          type="button"
          className={cx({ active: mode.value === value })}
          aria-pressed={mode.value === value}
          onClick={() => onChange(mode.value)}
        >
          <span>{mode.icon}</span>
          <b>{mode.title}</b>
          <small>{mode.note}</small>
        </button>
      ))}
    </div>
  );
}
