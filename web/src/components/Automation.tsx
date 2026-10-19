import { useEffect, useState } from 'react';
import {
  apiToken, controlToken, deleteFile, deleteMacro, deleteTrigger, describeStep, fileUrl, listFiles, runMacro, saveTrigger, setApiToken,
  testTrigger, toast, toggleTrigger,
} from '../lib/api';
import type { FileItem, Job, Macro, Step, Trigger, TriggerWhen } from '../lib/types';

interface Props { jobs: Job[]; triggers: Trigger[]; macros: Macro[]; onMacrosChanged: () => void }

/** Активная вкладка для тестов и макросов: своя (с токеном), последняя открытая. */
function activeTab(jobs: Job[]): { job: string; worker: string; name: string } | null {
  for (const j of jobs.filter(j => j.status === 'running' && controlToken(j.id)).reverse()) {
    const w = j.workers_list.find(w => w.state !== 'stopped'); if (w) return { job: j.id, worker: w.id, name: 'W-' + w.id.split('-').pop() };
  }
  return null;
}

export function Automation({ jobs, triggers, macros, onMacrosChanged }: Props) {
  const [token, setToken] = useState(apiToken());
  const [files, setFiles] = useState<FileItem[]>([]);
  const [filesError, setFilesError] = useState('');
  const loadFiles = async () => { if (!apiToken()) { setFiles([]); setFilesError('Введи API-ключ, чтобы видеть файлы.'); return; } const r = await listFiles(); if (!r.ok) { setFilesError(r.error || 'Ошибка'); return; } setFilesError(''); setFiles((r.files || []).slice(-30).reverse()); };
  useEffect(() => { loadFiles(); }, [token]);

  // ---- триггеры
  const [trName, setTrName] = useState(''); const [trKind, setTrKind] = useState('text'); const [trQuery, setTrQuery] = useState('');
  const [trThen, setTrThen] = useState('click'); const [trSteps, setTrSteps] = useState(''); const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);
  const build = (): { when: TriggerWhen; then: Step[] } | null => {
    const kind = (trKind.startsWith('role:') ? 'role' : trKind) as TriggerWhen['kind']; const role = trKind.startsWith('role:') ? trKind.slice(5) : 'button';
    const when: TriggerWhen = { kind, query: trQuery.trim(), role };
    if (!when.query) { toast('Укажи, что искать на странице', 'err'); return null; }
    let then: Step[];
    if (trThen === 'click') { if (kind === 'url') { toast('Для условия URL выбери другое действие', 'err'); return null; } then = [{ action: 'click', kind: kind as Step['kind'], role, query: when.query, optional: true }]; }
    else if (trThen.startsWith('press:')) then = [{ action: 'press', value: trThen.slice(6) }];
    else if (trThen === 'reload') then = [{ action: 'reload' }];
    else if (trThen === 'screenshot') then = [{ action: 'screenshot', name: trName.trim() }];
    else { try { then = JSON.parse(trSteps); if (!Array.isArray(then) || !then.length) throw new Error(); } catch { toast('Шаги должны быть JSON-массивом', 'err'); return null; } }
    return { when, then };
  };
  const test = async (when: TriggerWhen, then: Step[], run: boolean) => {
    const tab = activeTab(jobs);
    if (!tab) { setResult({ text: 'Нет своей открытой вкладки: открой страницу из этой панели', ok: false }); return; }
    setResult({ text: `Проверяю на вкладке ${tab.name}…`, ok: true });
    const r = await testTrigger(when, run ? then : [], tab.job, tab.worker, run);
    if (!r.ok) { setResult({ text: r.error || 'Проверка не удалась', ok: false }); return; }
    let host = ''; try { host = new URL(r.url || '').hostname.replace(/^www\./, ''); } catch { /* ignore */ }
    if (!r.matches) { setResult({ text: `✗ На ${host || 'странице'} (${tab.name}) сейчас не найдено${r.count ? ` · совпадений в DOM: ${r.count}, но ни одно не видно` : ''}`, ok: false }); return; }
    let text = `✓ Найдено на ${host || 'странице'} (${tab.name})${(r.count || 0) > 1 ? ` · элементов: ${r.count}, сработает первый видимый` : ''}`;
    if (r.run) text += r.run.ok ? ` · реакция выполнена: ${r.run.completed} шагов` : ` · реакция остановилась: ${r.run.error || 'ошибка'}`;
    setResult({ text, ok: true });
    if (r.box) window.dispatchEvent(new CustomEvent('katya-hit', { detail: { job: tab.job, worker: tab.worker, box: r.box } }));
  };
  const add = async () => {
    const t = build(); if (!t) return;
    const r = await saveTrigger({ name: trName.trim() || trQuery.trim().slice(0, 30), when: t.when, then: t.then, cooldown_ms: 5000 });
    toast(r.ok ? 'Триггер добавлен' : (r.error || 'Не удалось добавить'), r.ok ? 'ok' : 'err');
    if (r.ok) { setTrName(''); setTrQuery(''); }
  };

  const runInActive = async (name: string) => {
    const tab = activeTab(jobs); if (!tab) { toast('Сначала открой вкладку', 'err'); return; }
    const r = await runMacro(name, tab.job, tab.worker);
    toast(r.ok ? `Макрос выполнен во вкладке ${tab.name}: ${r.completed} шагов` : (r.error || `Остановлено на шаге ${(r.completed || 0) + 1}`), r.ok ? 'ok' : 'err');
  };

  return (
    <section className="card auto-card" id="autoCard">
      <div className="auto-head">
        <h2>Автоматизация · триггеры, макросы, файлы</h2>
        <details className="token-settings"><summary>Ключ API</summary>
          <div className="token-box"><input type="password" value={token} placeholder="Ключ API" autoComplete="off" onChange={e => { setToken(e.target.value); setApiToken(e.target.value); }} /><small>Файл data/api_token.txt · нужен для файлов и для агентов</small></div>
        </details>
      </div>
      <div className="auto-grid">
        <div className="auto-col">
          <h3>Триггеры <span className="hint">когда появится → сделать</span></h3>
          <div className="auto-list" data-empty="Пока нет триггеров. Пример: когда виден текст «Принять все» → кликнуть по нему.">
            {triggers.map(t => (
              <div className="auto-item" key={t.id}>
                <b>{t.name} · сработал {t.fired}×</b>
                <span className="meta">{t.when.kind}: {t.when.query} → {t.then.map(describeStep).join(', ')}</span>
                <span className="ops">
                  <button type="button" className="test" title="Проверить на активной вкладке" onClick={() => test(t.when, t.then, false)}>Тест</button>
                  <button type="button" className="run" title="Выполнить реакцию" onClick={() => test(t.when, t.then, true)}>▶</button>
                  <button type="button" className={'toggle' + (t.enabled ? '' : ' off')} onClick={() => toggleTrigger(t.id, !t.enabled)}>{t.enabled ? 'Вкл' : 'Выкл'}</button>
                  <button type="button" className="danger" onClick={async () => { const r = await deleteTrigger(t.id); toast(r.ok ? 'Триггер удалён' : (r.error || 'Ошибка'), r.ok ? 'ok' : 'err'); }}>✕</button>
                </span>
              </div>
            ))}
          </div>
          <form className="auto-form" onSubmit={e => { e.preventDefault(); add(); }}>
            <input type="text" className="wide" value={trName} onChange={e => setTrName(e.target.value)} placeholder="Название" maxLength={80} />
            <select value={trKind} onChange={e => setTrKind(e.target.value)}>
              <option value="text">Виден текст</option><option value="css">Виден CSS</option><option value="role:button">Видна кнопка</option><option value="role:link">Видна ссылка</option><option value="label">Виден label</option><option value="url">URL совпадает (regex)</option>
            </select>
            <input type="text" value={trQuery} onChange={e => setTrQuery(e.target.value)} placeholder="Что искать" maxLength={300} />
            <select className="wide" value={trThen} onChange={e => setTrThen(e.target.value)}>
              <option value="click">Кликнуть по найденному элементу</option><option value="press:Escape">Нажать Escape</option><option value="reload">Перезагрузить страницу</option><option value="screenshot">Сделать скриншот в файлы</option><option value="steps">Свои шаги (JSON ниже)</option>
            </select>
            {trThen === 'steps' && <textarea value={trSteps} onChange={e => setTrSteps(e.target.value)} placeholder='[{"action":"click","kind":"text","query":"Принять все"}]' />}
            <div className="wide trigger-test-row">
              <button type="button" onClick={() => { const t = build(); if (t) test(t.when, t.then, false); }}>Проверить на вкладке</button>
              <button type="button" onClick={() => { const t = build(); if (t) test(t.when, t.then, true); }}>Выполнить сейчас</button>
            </div>
            {result && <div className={'wide trigger-test-result ' + (result.ok ? 'ok' : 'err')}>{result.text}</div>}
            <button type="submit">Добавить триггер</button>
          </form>
        </div>
        <div className="auto-col">
          <h3>Макросы <button type="button" onClick={onMacrosChanged}>Обновить</button></h3>
          <div className="auto-list" data-empty="Запиши шаги во вкладке и нажми «Сохранить».">
            {macros.map(m => (
              <div className="auto-item" key={m.name}>
                <b>{m.name}</b><span className="meta">{m.steps.length} шагов: {m.steps.slice(0, 3).map(describeStep).join(' → ')}</span>
                <span className="ops">
                  <button type="button" className="run" onClick={() => runInActive(m.name)}>▶ В активной вкладке</button>
                  <button type="button" className="danger" onClick={async () => { if (!confirm(`Удалить макрос «${m.name}»?`)) return; const r = await deleteMacro(m.name); toast(r.ok ? 'Удалено' : (r.error || 'Ошибка'), r.ok ? 'ok' : 'err'); onMacrosChanged(); }}>✕</button>
                </span>
              </div>
            ))}
          </div>
          <p className="hint">Серверные сценарии видят MCP-агенты. «▶ В активной вкладке» запускает макрос в твоей последней открытой вкладке.</p>
        </div>
        <div className="auto-col">
          <h3>Файлы <button type="button" onClick={loadFiles}>Обновить</button></h3>
          <div className="auto-list" data-empty={filesError || 'Скриншоты и загрузки появятся здесь.'}>
            {!filesError && files.map(f => (
              <div className="auto-item" key={f.name}>
                <b>{f.name}</b><span className="meta">{(f.size / 1024).toFixed(1)} КБ · {new Date(f.modified * 1000).toLocaleString('ru-RU')}</span>
                <span className="ops"><a href={fileUrl(f.name)} target="_blank" rel="noopener">Открыть</a><button type="button" className="danger" onClick={async () => { await deleteFile(f.name); loadFiles(); }}>✕</button></span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
