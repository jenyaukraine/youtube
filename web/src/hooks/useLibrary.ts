import { useCallback, useEffect, useMemo, useState } from 'react';
import { listMacros } from '@/api/automation';
import { localScenarios } from '@/lib/storage';
import type { Macro, Scenario } from '@/lib/types';

/** Библиотека сценариев: локальные (в браузере) и макросы на сервере. */
export interface Library {
  scenarios: Scenario[];
  macros: Macro[];
  /** Перечитать и локальные сценарии, и макросы с сервера. */
  refresh: () => void;
}

export function useLibrary(): Library {
  const [scenarios, setScenarios] = useState<Scenario[]>(localScenarios);
  const [macros, setMacros] = useState<Macro[]>([]);

  const loadMacros = useCallback(() => listMacros().then(r => setMacros(r.ok ? r.macros : [])), []);
  useEffect(() => {
    loadMacros();
  }, [loadMacros]);

  const refresh = useCallback(() => {
    setScenarios(localScenarios());
    loadMacros();
  }, [loadMacros]);

  return useMemo(() => ({ scenarios, macros, refresh }), [scenarios, macros, refresh]);
}
