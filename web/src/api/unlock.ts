/** true — панель открыта; старый сервер без /api/unlock считается открытым. */
export async function unlockStatus(): Promise<boolean> {
  const response = await fetch('/api/unlock/status', { cache: 'no-store' });
  if (response.status === 404) return true;
  if (!response.ok) throw new Error('Не удалось проверить доступ к серверу');
  return Boolean(((await response.json()) as { unlocked?: boolean }).unlocked);
}

export async function unlock(pin: string) {
  const response = await fetch('/api/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  const result = (await response.json()) as { ok?: boolean; error?: string };
  if (!response.ok || !result.ok) throw new Error(result.error || 'Не удалось открыть');
}
