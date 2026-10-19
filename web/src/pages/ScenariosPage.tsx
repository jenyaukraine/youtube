import { useMemo, useState } from 'react';
import { ACTION_LABELS, STEP_FIELDS, STEP_HINTS, describeStep, saveLocalScenarios, startTabs, toast } from '../lib/api';
import type { ActionName, Scenario, Step } from '../lib/types';

interface Props { scenarios: Scenario[]; onChanged: () => void; onStarted: () => void }

const ACTIONS = Object.keys(STEP_FIELDS) as ActionName[];
const KINDS: Record<string, string> = { css: 'CSS', text: 'Текст', label: 'Label', role: 'Роль', placeholder: 'Placeholder', xpath: 'XPath' };

/** Страница «Сценарии»: список, редактор шагов (поля по действию), переменные, запуск. */
export function ScenariosPage({ scenarios, onChanged, onStarted }: Props) {
  const [selected, setSelected] = useState<string | null>(scenarios[0]?.id || null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const s = useMemo(() => scenarios.find(x => x.id === selected) || null, [scenarios, selected]);
  const save = (next: Scenario) => { saveLocalScenarios(scenarios.map(x => x.id === next.id ? next : x)); onChanged(); };
  const patchStep = (i: number, patch: Partial<Step>) => { if (!s) return; const steps = s.steps.map((st, k) => k === i ? { ...st, ...patch } : st); save({ ...s, steps }); };
  const variables = useMemo(() => { const found = new Set<string>(); for (const st of s?.steps || []) for (const m of String(st.value || '').matchAll(/{{\s*([a-zA-Z][\w]*)\s*}}/g)) found.add(m[1]); return [...found]; }, [s]);

  const create = () => { const sc: Scenario = { id: crypto.randomUUID(), name: 'Новый сценарий', startUrl: 'https://', steps: [], createdAt: new Date().toISOString() }; saveLocalScenarios([sc, ...scenarios]); onChanged(); setSelected(sc.id); };
  const remove = () => { if (!s || !confirm(`Удалить «${s.name}»?`)) return; saveLocalScenarios(scenarios.filter(x => x.id !== s.id)); onChanged(); setSelected(null); };
  const run = async () => {
    if (!s) return; if (!/^https?:\/\//.test(s.startUrl)) { toast('Укажи стартовую страницу', 'err'); return; }
    const vars = s.variables || {};
    const steps = s.steps.map(st => ({ ...st, value: String(st.value || '').replace(/{{\s*(\w+)\s*}}/g, (_, n) => n in vars ? vars[n] : `{{${n}}}`) }));
    if (steps.some(st => /{{\s*\w+\s*}}/.test(st.value || ''))) { toast('Заполни переменные перед запуском', 'err'); return; }
    const r = await startTabs({ url: s.startUrl, workers: 1, duration: 0, headers: s.settings?.headers || {}, user_agent_mode: s.settings?.user_agent_mode || 'chrome', steps });
    if (!r.ok) { toast(r.error || 'Ошибка запуска', 'err'); return; }
    toast('Вкладка открыта, сценарий запущен'); onStarted();
  };
  const exportJson = () => { const blob = new Blob([JSON.stringify(scenarios, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'katya-scenarios.json'; a.click(); };
  const importJson = async (file: File) => { try { const data = JSON.parse(await file.text()); const list = Array.isArray(data) ? data : [data]; saveLocalScenarios([...list.filter(x => x && x.steps).map(x => ({ ...x, id: x.id || crypto.randomUUID(), createdAt: x.createdAt || new Date().toISOString() })), ...scenarios]); onChanged(); toast(`Импортировано: ${list.length}`); } catch { toast('Не удалось прочитать JSON', 'err'); } };

  return (
    <div className="layout">
      <aside className="panel sidebar">
        <h2>Мои сценарии</h2>
        <button className="btn primary full" onClick={create}>+ Новый сценарий</button>
        <div className="scenario-list">
          {scenarios.map(x => <button key={x.id} className={x.id === selected ? 'active' : ''} onClick={() => { setSelected(x.id); setPicked(new Set()); }}><strong>{x.name}</strong><small>{x.steps.length} шагов · {x.startUrl}</small></button>)}
        </div>
        <div className="row" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={exportJson}>Скачать JSON</button>
          <label className="btn">Импорт JSON<input type="file" accept="application/json" hidden onChange={e => e.target.files?.[0] && importJson(e.target.files[0])} /></label>
        </div>
        <p className="hint">Сценарии хранятся в этом браузере и как макросы на сервере. Запись — во вкладке: «● Записать шаги», затем «💾 Сохранить».</p>
      </aside>
      <main className="panel">
        {!s ? <div className="empty">Выбери сценарий слева или создай новый.</div> : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0 }}>Редактор сценария</h2>
              <div style={{ display: 'flex', gap: 8 }}><button className="btn primary" onClick={run}>▶ Запустить во вкладке</button><button className="btn danger" onClick={remove}>Удалить</button></div>
            </div>
            <div className="cols">
              <div><label>Название</label><input value={s.name} onChange={e => save({ ...s, name: e.target.value })} maxLength={80} /></div>
              <div><label>Стартовая страница</label><input value={s.startUrl} onChange={e => save({ ...s, startUrl: e.target.value.trim() })} /></div>
            </div>
            <div className="section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div><h3>Шаги</h3><div className="hint">Поля зависят от действия. Чекбоксы — для удаления списком.</div></div>
                <button className="btn" onClick={() => save({ ...s, steps: [...s.steps, { action: 'click', kind: 'css', query: '', value: '' }] })}>+ Шаг</button>
              </div>
              {picked.size > 0 && (
                <div className="steps-bulk" style={{ margin: '10px 0' }}><span>Выбрано: {picked.size} из {s.steps.length}</span>
                  <button type="button" className="btn tiny danger" onClick={() => { save({ ...s, steps: s.steps.filter((_, i) => !picked.has(i)) }); setPicked(new Set()); }}>Удалить выбранные</button>
                  <button type="button" className="btn tiny" onClick={() => setPicked(new Set())}>Снять выбор</button></div>
              )}
              <div className="step-list">
                {s.steps.map((st, i) => {
                  const fields = STEP_FIELDS[st.action] || ['kind', 'query', 'value', 'x', 'y', 'end_x', 'end_y'];
                  const has = (f: string) => fields.includes(f);
                  return (
                    <div className="step" key={i}>
                      <div className="step-head">
                        <input type="checkbox" className="step-pick" checked={picked.has(i)} onChange={() => setPicked(p => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; })} aria-label={`Выбрать шаг ${i + 1}`} />
                        <strong>Шаг {i + 1}</strong><span className="step-summary">{describeStep(st)}</span>
                        <div className="row" style={{ display: 'flex', gap: 6 }}>
                          <button className="btn tiny" title="Вверх" disabled={i === 0} onClick={() => { const steps = [...s.steps];[steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; save({ ...s, steps }); }}>↑</button>
                          <button className="btn tiny" title="Вниз" disabled={i === s.steps.length - 1} onClick={() => { const steps = [...s.steps];[steps[i + 1], steps[i]] = [steps[i], steps[i + 1]]; save({ ...s, steps }); }}>↓</button>
                          <button className="btn tiny danger" title="Удалить" onClick={() => save({ ...s, steps: s.steps.filter((_, k) => k !== i) })}>×</button>
                        </div>
                      </div>
                      <div className="step-grid">
                        <div><label>Действие</label><select value={st.action} onChange={e => patchStep(i, { action: e.target.value as ActionName })}>{ACTIONS.map(a => <option key={a} value={a}>{ACTION_LABELS[a] || a}</option>)}</select></div>
                        {has('kind') && <div><label>Поиск элемента</label><select value={st.kind || 'css'} onChange={e => patchStep(i, { kind: e.target.value as Step['kind'] })}>{Object.entries(KINDS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>}
                        {has('query') && <div><label>Элемент / селектор</label><input value={st.query || ''} onChange={e => patchStep(i, { query: e.target.value })} placeholder="button, Продолжить, Email" /></div>}
                        {has('value') && <div><label>Значение / {'{{переменная}}'}</label><input value={st.value || ''} onChange={e => patchStep(i, { value: e.target.value })} placeholder={({ wait: '1500', press: 'Enter', scroll: '600', navigate: 'https://…', type: '{{username}}' } as Record<string, string>)[st.action] || ''} /></div>}
                        {has('x') && <div><label>X (0–1)</label><input type="number" min={0} max={1} step={0.01} value={st.x ?? 0} onChange={e => patchStep(i, { x: Number(e.target.value) })} /></div>}
                        {has('y') && <div><label>Y (0–1)</label><input type="number" min={0} max={1} step={0.01} value={st.y ?? 0} onChange={e => patchStep(i, { y: Number(e.target.value) })} /></div>}
                        {has('end_x') && <div><label>Конец X (0–1)</label><input type="number" min={0} max={1} step={0.01} value={st.end_x ?? 0} onChange={e => patchStep(i, { end_x: Number(e.target.value) })} /></div>}
                        {has('end_y') && <div><label>Конец Y (0–1)</label><input type="number" min={0} max={1} step={0.01} value={st.end_y ?? 0} onChange={e => patchStep(i, { end_y: Number(e.target.value) })} /></div>}
                        <div className="wide hint">{STEP_HINTS[st.action] || 'Укажи способ поиска и элемент.'}</div>
                      </div>
                    </div>
                  );
                })}
                {!s.steps.length && <div className="hint">Шагов пока нет. Запиши действия во вкладке или добавь шаг здесь.</div>}
              </div>
            </div>
            <div className="section">
              <h3>Переменные</h3>
              <div className="hint">В значении шага используй {'{{имя}}'}; пароли не хранятся, вводи их вручную.</div>
              <div className="variable-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
                {variables.map(name => <div key={name}><label>{`{{${name}}}`}</label><input type={name === 'password' ? 'password' : 'text'} value={name === 'password' ? '' : (s.variables?.[name] || '')} onChange={e => name !== 'password' && save({ ...s, variables: { ...(s.variables || {}), [name]: e.target.value } })} /></div>)}
                {!variables.length && <div className="hint">Переменных нет.</div>}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
