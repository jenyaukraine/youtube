export type ToastType = 'ok' | 'err';
export interface ToastMessage {
  msg: string;
  type: ToastType;
}

type Listener = (toast: ToastMessage) => void;
const listeners = new Set<Listener>();

export function toast(msg: string, type: ToastType = 'ok') {
  listeners.forEach(fn => fn({ msg, type }));
}

/** Сообщает результат запроса: при ошибке — текст сервера или запасной. */
export function toastResult(result: { ok: boolean; error?: string }, okText: string, errText = 'Ошибка') {
  toast(result.ok ? okText : result.error || errText, result.ok ? 'ok' : 'err');
}

export function onToast(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
