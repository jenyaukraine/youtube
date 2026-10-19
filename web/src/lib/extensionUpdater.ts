import { chromeBridge } from './chromeBridge';

type WritableDirectory = FileSystemDirectoryHandle & { requestPermission: (options: { mode: 'readwrite' }) => Promise<string> };
let directory: WritableDirectory | null = null;

function store(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('katya-extension-updater', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function restoreExtensionDirectory() {
  try {
    const db = await store();
    directory = await new Promise<WritableDirectory | null>((resolve, reject) => {
      const request = db.transaction('handles').objectStore('handles').get('extension');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
  } catch { directory = null; }
}

async function remember(handle: WritableDirectory | null) {
  const db = await store();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, 'extension');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function updateInstalledExtension(): Promise<{ version: string; reloaded: boolean }> {
  const picker = (window as Window & { showDirectoryPicker?: (options: object) => Promise<WritableDirectory> }).showDirectoryPicker;
  if (!picker) throw new Error('Обновление папки доступно в Google Chrome.');
  let handle = directory;
  if (!handle) handle = await picker({ id: 'katya-extension', mode: 'readwrite' });
  else if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Нужен доступ к папке расширения.');
  const installed = JSON.parse(await (await (await handle.getFileHandle('manifest.json')).getFile()).text());
  if (installed.name !== 'Katya Browser Bridge') {
    directory = null; await remember(null);
    throw new Error('Выберите папку Katya Browser Bridge с manifest.json.');
  }
  const response = await fetch('/api/extension-bundle', { cache: 'no-store' });
  if (!response.ok) throw new Error('Не удалось загрузить обновление.');
  const bundle = await response.json() as { ok: boolean; version: string; files: Record<string, string> };
  if (!bundle.ok || !bundle.version || !bundle.files?.['manifest.json']) throw new Error('Неверный пакет обновления.');
  for (const [name, contents] of Object.entries(bundle.files)) {
    if (!/^[\w.-]+$/.test(name) || typeof contents !== 'string') throw new Error('Неверный файл в пакете.');
    const writer = await (await handle.getFileHandle(name, { create: true })).createWritable();
    await writer.write(contents); await writer.close();
  }
  directory = handle; await remember(handle);
  const reply = await chromeBridge('reload-extension');
  return { version: bundle.version, reloaded: reply.ok };
}
