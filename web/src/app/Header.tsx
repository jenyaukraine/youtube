import { cx } from '@/lib/cx';

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12h4l2-7 4 14 2-7h6" />
    </svg>
  );
}

export function Header({ online }: { online: boolean }) {
  return (
    <header className="header">
      <div className="brand">
        <div className="brand-logo">
          <Logo />
        </div>
        <div>
          <h1>
            Katya <span>Browser Lab</span>
          </h1>
          <p>Вкладки, сценарии и действия в одном месте</p>
        </div>
      </div>
      <div className={cx('badge', online ? 'online' : 'offline')}>
        <span className="dot" />
        {online ? 'Сервер на связи' : 'Нет связи'}
      </div>
    </header>
  );
}
