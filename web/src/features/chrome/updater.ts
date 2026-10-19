import { chromeBridge } from './bridge';

// Обновление установленного расширения прямо в его папке через File System Access API (только Chrome).
// Выбранная папка запоминается в IndexedDB, чтобы следующий раз обходиться одной кнопкой.

type WritableDirectory = FileSystemDirectoryHandle & {
  requestPermission: (options: { mode: 'readwrite' }) => Promise<string>;
};

type DirectoryPicker = (options: { id: string; mode: 'readwrite' }) => Promise<WritableDirectory>;

interface Bundle {
  ok: boolean;
  version: string;
  files: Record<string, string>;
}

const DB_NAME = 'katya-extension-updater';
const STORE = 'handles';
const KEY = 'extension';
const EXTENSION_NAME = 'Katya Browser Bridge';
const SAFE_FILE_NAME = /^[\w.-]+$/;

let directory: WritableDirectory | null = null;

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Вспоминает папку расширения, выбранную в прошлый раз. */
export async function restoreExtensionDirectory() {
  try {
    const db = await openStore();
    directory = await new Promise<WritableDirectory | null>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
  } catch {
    directory = null;
  }
}

async function remember(handle: WritableDirectory | null) {
  const db = await openStore();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(handle, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function pickDirectory(): Promise<WritableDirectory> {
  const picker = (window as Window & { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  if (!picker) throw new Error('Обновление папки доступно в Google Chrome.');
  if (!directory) return picker({ id: 'katya-extension', mode: 'readwrite' });
  const permission = await directory.requestPermission({ mode: 'readwrite' });
  if (permission !== 'granted') throw new Error('Нужен доступ к папке расширения.');
  return directory;
}

async function manifestName(handle: WritableDirectory): Promise<string> {
  const file = await (await handle.getFileHandle('manifest.json')).getFile();
  const manifest = JSON.parse(await file.text()) as { name?: string };
  return manifest.name || '';
}

async function fetchBundle(): Promise<Bundle> {
  const response = await fetch('/api/extension-bundle', { cache: 'no-store' });
  if (!response.ok) throw new Error('Не удалось загрузить обновление.');
  const bundle = (await response.json()) as Bundle;
  if (!bundle.ok || !bundle.version || !bundle.files?.['manifest.json']) {
    throw new Error('Неверный пакет обновления.');
  }
  return bundle;
}

async function writeFile(handle: WritableDirectory, name: string, contents: string) {
  const writer = await (await handle.getFileHandle(name, { create: true })).createWritable();
  await writer.write(contents);
  await writer.close();
}

export async function updateInstalledExtension(): Promise<{ version: string; reloaded: boolean }> {
  const handle = await pickDirectory();
  if ((await manifestName(handle)) !== EXTENSION_NAME) {
    directory = null;
    await remember(null);
    throw new Error('Выберите папку Katya Browser Bridge с manifest.json.');
  }
  const bundle = await fetchBundle();
  for (const [name, contents] of Object.entries(bundle.files)) {
    if (!SAFE_FILE_NAME.test(name) || typeof contents !== 'string')
      throw new Error('Неверный файл в пакете.');
    await writeFile(handle, name, contents);
  }
  directory = handle;
  await remember(handle);
  const reply = await chromeBridge('reload-extension');
  return { version: bundle.version, reloaded: reply.ok };
}
