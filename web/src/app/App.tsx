import { useState } from 'react';
import { Automation } from '@/features/automation/Automation';
import { ChromeWorkspace } from '@/features/chrome/ChromeWorkspace';
import { StartForm } from '@/features/tabs/StartForm';
import { TabsPanel } from '@/features/tabs/TabsPanel';
import { useLibrary } from '@/hooks/useLibrary';
import { useLive } from '@/hooks/useLive';
import { launchMode, setLaunchMode, type LaunchMode } from '@/lib/storage';
import { Toast } from '@/ui/Toast';
import { Diagnostics } from './Diagnostics';
import { Header } from './Header';
import './app.css';

export default function App() {
  const { state, online } = useLive();
  const library = useLibrary();
  const [mode, setMode] = useState<LaunchMode>(launchMode);

  const changeMode = (next: LaunchMode) => {
    setLaunchMode(next);
    setMode(next);
  };

  return (
    <div className="wrap">
      <Header online={online} />

      {mode === 'chrome' ? (
        <ChromeWorkspace library={library} mode={mode} onMode={changeMode} />
      ) : (
        <div className="grid">
          <StartForm jobs={state.jobs} library={library} mode={mode} onMode={changeMode} />
          <TabsPanel jobs={state.jobs} library={library} memoryPercent={state.system.memory_percent} />
        </div>
      )}

      {mode === 'playwright' && (
        <>
          <details className="fold">
            <summary>Триггеры, макросы и файлы</summary>
            <Automation jobs={state.jobs} triggers={state.triggers || []} library={library} />
          </details>
          <Diagnostics system={state.system} log={state.log} />
        </>
      )}
      <Toast />
    </div>
  );
}
