import { useState } from 'react';
import type { Library } from '@/hooks/useLibrary';
import { apiToken, setApiToken } from '@/lib/storage';
import type { Job, Trigger } from '@/lib/types';
import { FilesPanel } from './FilesPanel';
import { MacrosPanel } from './MacrosPanel';
import { TokenField } from './TokenField';
import { TriggersPanel } from './TriggersPanel';
import './automation.css';

interface Props {
  jobs: Job[];
  triggers: Trigger[];
  library: Library;
}

/** Автоматизация: триггеры, макросы на сервере и файлы (скриншоты, загрузки). */
export function Automation({ jobs, triggers, library }: Props) {
  const [token, setToken] = useState(apiToken);

  const changeToken = (value: string) => {
    setApiToken(value);
    setToken(value);
  };

  return (
    <section className="auto">
      <div className="auto-head">
        <h2>Автоматизация · триггеры, макросы, файлы</h2>
        <TokenField value={token} onChange={changeToken} />
      </div>
      <div className="auto-grid">
        <TriggersPanel jobs={jobs} triggers={triggers} />
        <MacrosPanel jobs={jobs} library={library} />
        <FilesPanel token={token.trim()} />
      </div>
    </section>
  );
}
