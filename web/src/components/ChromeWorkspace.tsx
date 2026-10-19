import { toast } from '../lib/api';
import type { Macro, Scenario } from '../lib/types';
import { ScenariosPage } from '../pages/ScenariosPage';
import { ChromePreview } from './ChromePreview';
import { ScenarioPanel } from './ScenarioPanel';
import { EXTENSION_VERSION, useChromeWorkspace } from './useChromeWorkspace';

interface Props { scenarios: Scenario[]; macros: Macro[]; onBack: () => void; onScenariosChanged: () => void }

export function ChromeWorkspace({ scenarios, macros, onBack, onScenariosChanged }: Props) {
  const c = useChromeWorkspace({ scenarios, macros, onScenariosChanged });
  const loadOptions = [
    ...scenarios.map(s => ({ label: s.name, value: `scenario:${s.id}` })),
    ...macros.map(m => ({ label: `${m.name} · сервер`, value: `macro:${m.name}` })),
  ];

  return <div className="grid chrome-react-grid">
    <div className="card chrome-control-card">
      <h2>Открыть вкладку</h2>
      <label htmlFor="chrome-url">Адрес страницы</label>
      <input id="chrome-url" type="url" value={c.url} onChange={e => c.setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && c.start()} spellCheck={false} />
      <label>Способ запуска</label>
      <div className="method-switch" role="group" aria-label="Способ запуска">
        <button type="button" onClick={onBack}><span>◈</span><b>Playwright</b><small>На сервере</small></button>
        <button type="button" className="active" aria-pressed="true"><span>◎</span><b>Мой Chrome</b><small>Через расширение</small></button>
      </div>
      <div className="chrome-connection">
        <strong className={c.connected && c.version === EXTENSION_VERSION ? 'connected' : 'error'}>{!c.connected ? 'Расширение не найдено' : c.version !== EXTENSION_VERSION ? `Нужно обновить до ${EXTENSION_VERSION}` : 'Chrome подключён'}</strong>
        <small>{c.tab ? `${c.tab.title} · ${c.tab.url}` : 'Подключённой вкладки пока нет'}</small>
      </div>
      <details className="chrome-existing" onToggle={e => { if (e.currentTarget.open) c.refreshTabs(); }}>
        <summary>Подключить открытую вкладку</summary>
        <div className="chrome-tab-list">{c.tabs.map(tab => <button type="button" key={tab.id} onClick={() => c.attach(tab.id)}><b>{tab.title}</b><small>{tab.url}</small></button>)}</div>
      </details>
      <details className="chrome-install" open={c.connected && c.version !== EXTENSION_VERSION}>
        <summary>Установка и обновление расширения</summary>
        <button type="button" className="chrome-update-button" disabled={c.updating} onClick={c.updateExtension}>{c.updating ? 'Обновляю…' : 'Обновить расширение'}</button>
        <div className="hint" aria-live="polite">{c.updateMessage || 'При первом обновлении выберите папку установленного расширения. Затем достаточно кнопки.'}</div>
        <p><a href="/Katya-Browser-Bridge.zip" download>Скачать ZIP для первой установки ↗</a></p>
      </details>
      <label htmlFor="chrome-start-scenario">Сценарий при открытии</label>
      <select id="chrome-start-scenario" value={c.choice} onChange={e => c.selectScenario(e.target.value)}>
        <option value="">Нет, просто открыть страницу</option>
        {scenarios.filter(s => s.steps.length).map(s => <option key={s.id} value={`scenario:${s.id}`}>{s.name} ({s.steps.length} шагов)</option>)}
        {macros.filter(m => !scenarios.some(s => s.name === m.name)).map(m => <option key={m.name} value={`macro:${m.name}`}>{m.name} (сервер)</option>)}
      </select>
      <div className="hint">После загрузки страницы сценарий ждёт 3 секунды. Шаги видны справа.</div>
      <div className="btn-row">
        <button type="button" className="btn btn-go" disabled={c.busy || !c.connected || c.version !== EXTENSION_VERSION} onClick={c.start}>{c.steps.length && c.choice ? 'Запустить сценарий' : 'Открыть в Chrome'}</button>
        <button type="button" className="btn btn-stop" disabled={!c.replaying} onClick={c.stop}>Стоп</button>
      </div>
    </div>
    <div className="card chrome-react-workspace">
      <h2>Вкладка Chrome</h2>
      <details className="scenarios-inline"><summary>Сохранённые сценарии · {scenarios.length + macros.length}</summary><ScenariosPage scenarios={scenarios} macros={macros} onChanged={onScenariosChanged} onMacrosChanged={onScenariosChanged} onStarted={() => undefined} /></details>
      <div className="chrome-toolbar"><span className="chrome-mode-label">{c.tab ? c.tab.title || 'Живая вкладка' : 'Нет подключённой вкладки'}</span>{c.tab && <button type="button" className="btn" onClick={c.detach}>Отключить</button>}</div>
      {c.visibility === 'hidden' && c.video && !c.video.paused && <div className="chrome-media-state">Восстанавливаю активность вкладки для воспроизведения…</div>}
      <ChromePreview frame={c.frame} message={c.message} video={c.video} onActivity={() => { c.lastActivity.current = Date.now(); c.shot(); }} onVideoAction={c.videoAction} />
      <div className="record-status" aria-live="polite">{c.waitLeft ? `Пауза · осталось ${(c.waitLeft / 1000).toFixed(1)} с` : c.message}</div>
      <ScenarioPanel scenarioSteps={c.steps} status={c.phase} clientRun={c.run} chipPicked={c.chipPicked}
        onChipPick={i => { c.setChipPicked(i); c.setFrom(i); }} onRunFrom={() => c.play(c.steps, c.chipPicked ?? 0)} onClearPick={c.clearPick}
        steps={c.steps} from={c.from} picked={c.picked} recording={c.recording} replaying={c.replaying} repeat={c.repeat} setRepeat={c.setRepeat}
        statusText={c.recording ? '● Запись идёт · действия и паузы сохраняются' : `${c.steps.length} шагов`}
        onToggleRecord={c.toggleRecord} onReplay={() => c.replaying ? c.stop() : c.play(c.steps, c.from)} onSave={c.save}
        onLoad={c.loadScenario} loadOptions={loadOptions} onPickStart={c.setFrom} onToggle={c.togglePick} onDelete={c.deletePicked}
        onUnpick={() => { c.setPicked(new Set()); c.setFrom(0); }}
        onPatchStep={(i, step) => c.patchSteps(c.steps.map((old, n) => n === i ? step : old))}
        onRemoveStep={i => c.patchSteps(c.steps.filter((_, n) => n !== i))}
        onCopy={() => navigator.clipboard.writeText(JSON.stringify(c.steps, null, 2)).then(() => toast('Шаги скопированы'))}
        onClear={() => c.patchSteps([])} onManual={c.execute} />
    </div>
  </div>;
}
