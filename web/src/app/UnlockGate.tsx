import { useEffect, useRef, useState, type FormEvent } from 'react';
import { unlock, unlockStatus } from '@/api/unlock';
import { errorText } from '@/lib/text';
import App from './App';
import { Logo } from './Header';
import './unlock.css';

const PIN_LENGTH = 5;

/** Стартовый экран с кодом доступа; после входа рендерит панель. */
export function UnlockGate() {
  const [state, setState] = useState<'checking' | 'locked' | 'unlocked'>('checking');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    unlockStatus()
      .then(open => live && setState(open ? 'unlocked' : 'locked'))
      .catch(() => {
        if (!live) return;
        setState('locked');
        setError('Нет связи с сервером');
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (state === 'locked') input.current?.focus();
  }, [state]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pin.length !== PIN_LENGTH || busy) return;
    setBusy(true);
    setError('');
    try {
      await unlock(pin);
      setState('unlocked');
    } catch (reason) {
      setError(errorText(reason, 'Не удалось открыть'));
      setPin('');
      input.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  if (state === 'unlocked') return <App />;

  return (
    <main className="unlock">
      <div className="unlock-halo" aria-hidden="true" />
      <section className="unlock-card" aria-labelledby="unlock-title">
        <div className="unlock-logo" aria-hidden="true">
          <Logo />
        </div>
        <p className="unlock-kicker">TECHNO PUNCH / CONTROL ROOM</p>
        <h1 id="unlock-title">
          Katya <span>Browser Lab</span>
        </h1>
        <p className="unlock-copy">Введите код, чтобы открыть рабочую панель</p>
        {state === 'checking' ? (
          <div className="unlock-checking" role="status">
            Подключение…
          </div>
        ) : (
          <form onSubmit={submit}>
            <label htmlFor="unlock-pin">Код доступа</label>
            <div className="unlock-pin">
              <input
                ref={input}
                id="unlock-pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                maxLength={PIN_LENGTH}
                value={pin}
                onChange={e => {
                  setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH));
                  setError('');
                }}
                aria-invalid={!!error}
                aria-describedby={error ? 'unlock-error' : undefined}
              />
              <div className="unlock-dots" aria-hidden="true">
                {Array.from({ length: PIN_LENGTH }, (_, i) => (
                  <span key={i} className={i < pin.length ? 'filled' : ''} />
                ))}
              </div>
            </div>
            {error && (
              <p id="unlock-error" className="unlock-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="btn btn-primary btn-lg btn-block"
              type="submit"
              disabled={pin.length !== PIN_LENGTH || busy}
            >
              {busy ? 'Открываем…' : 'Открыть панель'} <span aria-hidden="true">↗</span>
            </button>
            <p className="unlock-enter">{PIN_LENGTH} цифр · Enter</p>
          </form>
        )}
      </section>
    </main>
  );
}
