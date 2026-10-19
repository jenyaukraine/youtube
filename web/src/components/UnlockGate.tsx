import { useEffect, useRef, useState, type FormEvent } from 'react';
import App from '../App';

export function UnlockGate() {
  const [state, setState] = useState<'checking' | 'locked' | 'unlocked'>('checking');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/unlock/status', { cache: 'no-store' })
      .then(async r => {
        if (r.status === 404) return { unlocked: true }; // older local server during development
        if (!r.ok) throw new Error('Не удалось проверить доступ к серверу');
        return r.json();
      })
      .then(result => { if (live) setState(result.unlocked ? 'unlocked' : 'locked'); })
      .catch(() => { if (live) { setState('locked'); setError('Нет связи с сервером'); } });
    return () => { live = false; };
  }, []);

  useEffect(() => { if (state === 'locked') input.current?.focus(); }, [state]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pin.length !== 5 || busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/unlock', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Не удалось открыть');
      setState('unlocked');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось открыть');
      setPin('');
      input.current?.focus();
    } finally { setBusy(false); }
  }

  if (state === 'unlocked') return <App />;
  return <main className="unlock-page">
    <div className="unlock-halo" aria-hidden="true" />
    <section className="unlock-card" aria-labelledby="unlock-title">
      <div className="unlock-logo" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 25h9l5-14 9 27 5-14h10" /></svg></div>
      <p className="unlock-kicker">TECHNO PUNCH / CONTROL ROOM</p>
      <h1 id="unlock-title">Katya <span>Browser Lab</span></h1>
      <p className="unlock-copy">Введите код, чтобы открыть рабочую панель</p>
      {state === 'checking' ? <div className="unlock-checking" role="status">Подключение…</div> : <form onSubmit={submit}>
        <label className="unlock-label" htmlFor="unlock-pin">Код доступа</label>
        <div className="unlock-pin-wrap">
          <input ref={input} id="unlock-pin" type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={5} value={pin}
            onChange={event => { setPin(event.target.value.replace(/\D/g, '').slice(0, 5)); setError(''); }} aria-invalid={!!error} aria-describedby={error ? 'unlock-error' : undefined} />
          <div className="unlock-dots" aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <span key={i} className={i < pin.length ? 'filled' : ''} />)}</div>
        </div>
        {error && <p id="unlock-error" className="unlock-error" role="alert">{error}</p>}
        <button className="unlock-submit" type="submit" disabled={pin.length !== 5 || busy}>{busy ? 'Открываем…' : 'Открыть панель'} <span aria-hidden="true">↗</span></button>
        <p className="unlock-enter">5 цифр · Enter</p>
      </form>}
    </section>
  </main>;
}
