(() => {
  const $ = id => document.getElementById(id);
  const STORE = 'katya_scenarios_v1';
  const pending = new Map();
  let tab = null, playing = false, cancelled = false, recorded = [], recording = false;

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'katya-extension') return;
    const request = pending.get(event.data.id);
    if (!request) return;
    clearTimeout(request.timer); pending.delete(event.data.id); request.resolve(event.data.reply);
  });
  function bridge(command, payload = {}) {
    return new Promise(resolve => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { pending.delete(id); resolve({ok: false, error: 'Расширение не отвечает. Установите его и обновите страницу.'}); }, command === 'execute' ? 35000 : 5000);
      pending.set(id, {resolve, timer});
      window.postMessage({source: 'katya-dashboard', id, command, payload}, location.origin);
    });
  }
  function scenarios() { try { const data = JSON.parse(localStorage.getItem(STORE) || '[]'); return Array.isArray(data) ? data : []; } catch { return []; } }
  function source() {
    return startSource();
  }
  function stepLabel(step) {
    const value = step.query || (['fill', 'type'].includes(step.action) ? '' : step.value);
    return `${step.action}${value ? ' · ' + String(value).slice(0, 80) : ''}`;
  }
  function renderSteps(steps, target) {
    target.replaceChildren(...steps.map((step, index) => {
      const li = document.createElement('li'); li.textContent = `${index + 1}. ${stepLabel(step)}`; return li;
    }));
  }
  function showScenario() {
    const steps = source()?.steps || [];
    $('chromeStepCount').textContent = `${steps.length} шагов`;
    renderSteps(steps, $('chromeStepList'));
    if ($('launchMethod').value === 'chrome') $('btnStart').textContent = steps.length ? 'Запустить сценарий' : 'Открыть в Chrome';
  }
  function runState(text, status = '') { $('chromeRunState').textContent = text; $('chromeRunState').className = 'chrome-run-state ' + status; }
  function setMode() {
    const chromeMode = $('launchMethod').value === 'chrome';
    localStorage.setItem('katya_launch_method', $('launchMethod').value);
    $('chromeSetup').hidden = !chromeMode;
    $('chromeWorkspace').hidden = !chromeMode;
    $('serverWorkspace').hidden = chromeMode;
    $('goalPanel').hidden = chromeMode;
    $('logBox').hidden = chromeMode;
    $('autoCard').hidden = chromeMode;
    document.querySelectorAll('.server-only').forEach(el => el.hidden = chromeMode);
    $('btnStop').disabled = chromeMode ? !playing : !curJob;
    $('scenarioHint').textContent = chromeMode ? 'Сценарий выполнится в подключённой вкладке Chrome после 10 секунд ожидания. Шаги видны справа.' : 'Вкладка откроет адрес и сразу выполнит сохранённые шаги. Повторы — в поле справа от «Повторить».';
    $('btnStart').textContent = chromeMode ? 'Открыть в Chrome' : 'Запустить';
    showScenario();
    if (chromeMode) refreshStatus();
  }
  async function refreshStatus() {
    const result = await bridge('status');
    const badge = $('bridgeStatus');
    badge.classList.toggle('err', !result.ok);
    badge.textContent = result.ok ? (result.tab ? '● Chrome подключён' : '● Расширение установлено') : '● Расширение не найдено';
    tab = result.tab || null;
    $('connectedTab').textContent = tab ? `${tab.title || 'Вкладка'} · ${tab.url}` : 'Вкладка не подключена';
    if ($('launchMethod').value === 'chrome') $('heroWorkers').textContent = tab ? '1' : '0';
    if (!result.ok && $('launchMethod').value === 'chrome') $('chromeSetup').querySelector('.chrome-install').open = true;
    if (result.ok) {
      recording = !!result.recording;
      $('chromeEventCount').textContent = `${result.events || 0} действий`;
      $('chromeRecord').disabled = recording;
      $('chromeFinish').disabled = !recording;
    }
  }
  async function shot() {
    const result = await bridge('screenshot');
    if (!result.ok) { toast(result.error || 'Нет снимка', 'err'); return; }
    $('chromeShotImage').src = result.image;
    $('chromeShotImage').hidden = false;
    $('chromeShotEmpty').hidden = true;
  }
  function substitute(step, scenario) {
    const vars = scenario.variables || {};
    const replace = raw => String(raw || '').replace(/{{\s*([\w]+)\s*}}/g, (_, name) => {
      if (name === 'password') throw new Error('Пароль вводится вручную во вкладке Chrome.');
      if (!(name in vars)) throw new Error(`Заполни переменную ${name} на странице сценариев.`);
      return String(vars[name]);
    });
    return {...step, value: replace(step.value), query: replace(step.query)};
  }
  async function pause(ms) {
    const end = Date.now() + ms;
    while (!cancelled && Date.now() < end) {
      runState(`Пауза · осталось ${((end - Date.now()) / 1000).toFixed(1)} с`, 'running');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  async function start() {
    const url = $('url').value.trim();
    if (!/^https?:\/\//i.test(url)) { toast('Укажи полный адрес http(s)', 'err'); return; }
    const selected = source();
    const repeat = Number($('chromeRepeat').value);
    if (selected?.steps?.length && (!Number.isInteger(repeat) || repeat < 1 || repeat > 50)) { toast('Повторов должно быть от 1 до 50', 'err'); return; }
    $('btnStart').disabled = true;
    try {
      if (!tab || tab.url !== url) {
        const opened = await bridge('open', {url});
        if (!opened.ok) throw new Error(opened.error || 'Не удалось открыть вкладку');
        tab = opened.tab;
      }
      await refreshStatus();
      if (!selected?.steps?.length) { runState('Вкладка открыта · можно записывать действия'); return; }
      playing = true; cancelled = false; $('btnStop').disabled = false;
      const items = [...$('chromeStepList').children];
      for (let pass = 0; pass < repeat && !cancelled; pass++) {
        if (pass > 0) {
          runState(`Повтор ${pass + 1}/${repeat} · открываю страницу`, 'running');
          const next = await bridge('execute', {step: {action: 'navigate', value: url}});
          if (!next.ok) throw new Error(next.error || 'Не удалось открыть страницу');
        }
        await pause(10000);
        for (let i = 0; i < selected.steps.length && !cancelled; i++) {
          const step = substitute(selected.steps[i], selected);
          items.forEach((li, index) => { li.classList.toggle('current', index === i); li.classList.toggle('done', index < i); });
          runState(`Повтор ${pass + 1}/${repeat} · шаг ${i + 1}/${selected.steps.length} · ${stepLabel(step)}`, 'running');
          if (step.action === 'wait') { await pause(Math.min(60000, Math.max(0, Number(step.value) || 0))); continue; }
          if (step.action === 'screenshot') { await shot(); continue; }
          const result = await bridge('execute', {step});
          if (!result.ok) throw new Error(`Шаг ${i + 1}: ${result.error || 'ошибка'}`);
        }
      }
      runState(cancelled ? 'Остановлено' : `Готово · ${repeat} повторов`);
      items.forEach(li => li.classList.remove('current'));
      if (!cancelled) items.forEach(li => li.classList.add('done'));
    } catch (error) { runState(error.message, 'err'); toast(error.message, 'err'); }
    finally { playing = false; $('btnStart').disabled = false; $('btnStop').disabled = true; refreshStatus(); }
  }
  function stop() { cancelled = true; runState('Останавливаю после текущего действия…', 'running'); }
  function eventsToSteps(events) {
    const steps = []; let last = null;
    for (const event of events) {
      if (last !== null) {
        let gap = Math.max(0, Number(event.at) - last);
        while (gap >= 350) { const part = Math.min(60000, Math.round(gap / 100) * 100); steps.push({action: 'wait', value: String(part)}); gap -= part; }
      }
      steps.push(event.step); last = Number(event.at);
    }
    return steps;
  }
  $('chromeShot').onclick = shot;
  $('chromeDetach').onclick = async () => { const r = await bridge('detach'); if (!r.ok) toast(r.error, 'err'); await refreshStatus(); };
  $('chromeRecord').onclick = async () => {
    const r = await bridge('record', {enabled: true});
    if (!r.ok) { toast(r.error, 'err'); return; }
    recorded = []; recording = true; $('chromeRecord').disabled = true; $('chromeFinish').disabled = false;
    $('chromeRecordedList').replaceChildren(); runState('Запись идёт · действуй в подключённой вкладке', 'running');
  };
  $('chromeFinish').onclick = async () => {
    await bridge('record', {enabled: false});
    const r = await bridge('events');
    if (!r.ok) { toast(r.error, 'err'); return; }
    recorded = eventsToSteps(r.events || []);
    renderSteps(recorded, $('chromeRecordedList'));
    $('chromeEventCount').textContent = `${r.events.length} действий · ${recorded.length} шагов`;
    recording = false; $('chromeRecord').disabled = false; $('chromeFinish').disabled = true;
    runState('Запись готова · укажи название и сохрани');
  };
  $('chromeSave').onclick = () => {
    if (!recorded.length) { toast('Сначала запиши действия', 'err'); return; }
    const name = $('chromeRecordName').value.trim() || `Chrome запись ${new Date().toLocaleString('ru-RU')}`;
    const item = {id: crypto.randomUUID(), name, startUrl: $('url').value.trim(), steps: recorded, variables: {}, createdAt: new Date().toISOString()};
    localStorage.setItem(STORE, JSON.stringify([item, ...scenarios()].slice(0, 50)));
    fillStartScenario(); $('startScenario').value = `scenario:${item.id}`; showScenario();
    toast('Сценарий сохранён в этом браузере');
  };
  $('startScenario').addEventListener('change', showScenario);
  $('launchMethod').addEventListener('change', setMode);
  const requested = new URLSearchParams(location.search).get('method');
  $('launchMethod').value = requested === 'chrome' ? 'chrome' : localStorage.getItem('katya_launch_method') || 'playwright';
  setMode(); showScenario();
  setInterval(() => { if ($('launchMethod').value === 'chrome' && !playing) refreshStatus(); }, 3000);
  window.chromePanel = {start, stop, get playing() { return playing; }};
})();
