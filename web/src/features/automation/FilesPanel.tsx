import { useCallback, useEffect, useState } from 'react';
import { deleteFile, fileUrl, listFiles } from '@/api/automation';
import { toastResult } from '@/lib/toast';
import type { FileItem } from '@/lib/types';
import { AutoItem } from './AutoItem';

interface Props {
  /** Ключ API: без него файлы недоступны; смена ключа перечитывает список. */
  token: string;
}

const LIMIT = 30;

const fileMeta = (f: FileItem) =>
  `${(f.size / 1024).toFixed(1)} КБ · ${new Date(f.modified * 1000).toLocaleString('ru-RU')}`;

/** Файлы на сервере: скриншоты и загрузки, последние 30, новые сверху. */
export function FilesPanel({ token }: Props) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(() => {
    if (!token) return;
    listFiles().then(r => {
      setLoadError(r.ok ? '' : r.error || 'Ошибка');
      setFiles(r.ok ? r.files.slice(-LIMIT).reverse() : []);
    });
  }, [token]);

  useEffect(load, [load]);

  const remove = async (name: string) => {
    toastResult(await deleteFile(name), 'Файл удалён');
    load();
  };

  const error = token ? loadError : 'Введи API-ключ, чтобы видеть файлы.';
  const shown = token ? files : [];

  return (
    <div className="auto-col">
      <h3>
        Файлы
        <button type="button" className="btn btn-sm btn-ghost" onClick={load}>
          Обновить
        </button>
      </h3>
      <div className="auto-list">
        {!error &&
          shown.map(f => (
            <AutoItem key={f.name} name={f.name} meta={fileMeta(f)}>
              <a className="btn btn-sm" href={fileUrl(f.name)} target="_blank" rel="noopener">
                Открыть
              </a>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                title="Удалить"
                onClick={() => remove(f.name)}
              >
                ✕
              </button>
            </AutoItem>
          ))}
        {(error || !shown.length) && (
          <p className="auto-empty">{error || 'Скриншоты и загрузки появятся здесь.'}</p>
        )}
      </div>
    </div>
  );
}
