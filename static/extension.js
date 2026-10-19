(() => {
  const STORE = 'katya_scenarios_v1';
  const $ = id => document.getElementById(id);
  const pending = new Map();
  let selectedTab = null, recording = false, recorded = [], cancelled = false, playing = false;

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'katya-extension') return;
    const item = pending.get(event.data.id);
    if (item) { clearTimeout(item.timer); pending.delete(event.data.id); item.resolve(event.data.reply); }
  });
  function bridge(command, payload = {}) {
    return new Promise(resolve => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { pending.delete(id); resolve({ok: false, error: 'Расширение не отвечает. Установи его и обнови страницу.'}); }, command === 'execute' ? 35000 : 5000);
      pending.set(id, {resolve, timer});
      window.postMessage({source: 'katya-dashboard', id, command, payload}, location.origin);
    });
  }
  function toast(message) { const el = $('toast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3500); }
  function scenarios() { try { const list = JSON.parse(localStorage.getItem(STORE) || '[]'); return Array.isArray(list) ? list : []; } catch { return []; } }
  function selected() { return scenarios().find(item => item.id === $('scenarioPick').value); }
  function label(step) { return `${step.action}${step.query ? ' · ' + step.query : step.value && step.action !== 'fill' && step.action !== 'type' ? ' · ' + String(step.value).slice(0, 65) : ''}`; }
  function renderSteps(steps, target) {
    target.replaceChildren(...steps.map((step, i) => { const li = document.createElement('li'); li.textContent = `${i + 1}. ${label(step)}`; return li; }));
  }
  function refreshScenarios() {
    const current = $('scenarioPick').value;
    $('scenarioPick').replaceChildren(new Option('Выбери сценарий…', ''), ...scenarios().map(item => new Option(`${item.name} · ${item.steps?.length || 0} шагов`, item.id)));
    $('scenarioPick').value = current;
    const s = selected();
    $('scenarioNote').textContent = s ? `${s.startUrl || 'Без стартового URL'} · ${s.steps?.length || 0} шагов` : 'Сценарии берутся из этой панели. Создай или запиши новый ниже.';
    renderSteps(s?.steps || [], $('stepList'));
  }
  async function refreshStatus() {
    const reply = await bridge('status');
    const badge = $('bridgeStatus'), tab = $('connectedTab');
    badge.classList.toggle('ok', Boolean(reply.ok)); badge.classList.toggle('err', !reply.ok);
    badge.textContent = reply.ok ? (reply.tab ? '● Chrome подключён' : '● Расширение установлено') : '● Расширение не найдено';
    selectedTab = reply.tab || null;
    tab.classList.toggle('on', Boolean(selectedTab));
    tab.textContent = selectedTab ? `${selectedTab.title || 'Вкладка'} · ${selectedTab.url}` : 'Вкладка пока не подключена';
    if (reply.ok) { recording = Boolean(reply.recording); $('eventCount').textContent = `${reply.events || 0} действий`; }
  }
  function runStatus(text, cls = '') { $('runState').textContent = text; $('runState').className = 'run-state ' + cls; }
  function wait(ms) { return new Promise(resolve => {
    const end = Date.now() + ms;
    const tick = () => { if (cancelled || Date.now() >= end) resolve(); else { runStatus(`Пауза · осталось ${((end - Date.now()) / 1000).toFixed(1)} с`, 'running'); setTimeout(tick, 100); } };
    tick();
  }); }
  function substitute(step, scenario) {
    const variables = scenario.variables || {};
    const replace = raw => String(raw || '').replace(/{{\s*([\w]+)\s*}}/g, (_, name) => {
      if (name === 'password') throw new Error('Пароль вводится только вручную в Chrome.');
      if (!(name in variables)) throw new Error(`Заполни переменную ${name} на странице сценариев.`);
      return String(variables[name]);
    });
    return {...step, value: replace(step.value), query: replace(step.query)};
  }
  async function play() {
    const scenario = selected();
    if (!scenario?.steps?.length) { toast('Выбери сценарий с шагами'); return; }
    const repeat = Number($('repeat').value);
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > 50) { toast('Укажи от 1 до 50 повторов'); return; }
    if (!selectedTab) { toast('Сначала подключи вкладку Chrome'); return; }
    cancelled = false; playing = true; $('play').disabled = true; $('stop').disabled = false;
    const list = [...$('stepList').children];
    try {
      for (let run = 0; run < repeat && !cancelled; run++) {
        if (scenario.startUrl) {
          runStatus(`Повтор ${run + 1}/${repeat} · открываю страницу`, 'running');
          const opened = await bridge('execute', {step: {action: 'navigate', value: substitute({value: scenario.startUrl}, scenario).value}});
          if (!opened.ok) throw new Error(opened.error || 'Не удалось открыть страницу');
        }
        await wait(10000);
        for (let i = 0; i < scenario.steps.length && !cancelled; i++) {
          const step = substitute(scenario.steps[i], scenario);
          list.forEach((li, n) => { li.classList.toggle('current', n === i); li.classList.toggle('done', n < i); });
          runStatus(`Повтор ${run + 1}/${repeat} · шаг ${i + 1}/${scenario.steps.length} · ${label(step)}`, 'running');
          if (step.action === 'wait') { await wait(Math.min(60000, Math.max(0, Number(step.value) || 0))); continue; }
          if (step.action === 'screenshot') {
            const shot = await bridge('screenshot');
            if (!shot.ok) throw new Error(`Шаг ${i + 1}: ${shot.error || 'не удалось сделать снимок'}`);
            $('shot').src = shot.image; $('shot').hidden = false; $('shotEmpty').hidden = true;
            continue;
          }
          const result = await bridge('execute', {step});
          if (!result.ok) throw new Error(`Шаг ${i + 1}: ${result.error || 'ошибка'}`);
        }
      }
      runStatus(cancelled ? 'Остановлено' : `Готово · ${repeat} повторов`);
      if (!cancelled) list.forEach(li => { li.classList.remove('current'); li.classList.add('done'); });
    } catch (error) { runStatus(error.message, 'err'); toast(error.message); }
    finally { playing = false; $('play').disabled = false; $('stop').disabled = true; refreshStatus(); }
  }
  function eventsToSteps(events) {
    const steps = []; let last = null;
    for (const event of events) {
      if (last !== null) {
        let gap = Math.max(0, Number(event.at) - last);
        while (gap >= 350) { const chunk = Math.min(60000, Math.round(gap / 100) * 100); steps.push({action: 'wait', value: String(chunk)}); gap -= chunk; }
      }
      steps.push(event.step); last = Number(event.at);
    }
    return steps;
  }
  $('refreshStatus').onclick = refreshStatus;
  $('detachTab').onclick = async () => { const r = await bridge('detach'); if (!r.ok) toast(r.error); await refreshStatus(); };
  $('openTab').onclick = async () => { const r = await bridge('open', {url: $('openUrl').value.trim()}); if (!r.ok) toast(r.error); await refreshStatus(); };
  $('takeShot').onclick = async () => {
    const r = await bridge('screenshot'); if (!r.ok) { toast(r.error); return; }
    $('shot').src = r.image; $('shot').hidden = false; $('shotEmpty').hidden = true;
  };
  $('scenarioPick').onchange = refreshScenarios;
  $('play').onclick = play;
  $('stop').onclick = () => { cancelled = true; runStatus('Останавливаю после текущего действия…', 'running'); };
  $('record').onclick = async () => {
    const r = await bridge('record', {enabled: true}); if (!r.ok) { toast(r.error); return; }
    recording = true; recorded = []; $('record').disabled = true; $('finish').disabled = false; $('recordedList').replaceChildren(); toast('Запись начата · действуй в подключённой вкладке');
  };
  $('finish').onclick = async () => {
    await bridge('record', {enabled: false}); const r = await bridge('events');
    recording = false; $('record').disabled = false; $('finish').disabled = true;
    if (!r.ok) { toast(r.error); return; }
    recorded = eventsToSteps(r.events || []); renderSteps(recorded, $('recordedList'));
    $('eventCount').textContent = `${r.events.length} действий · ${recorded.length} шагов`;
    toast('Запись готова. Дай ей имя и сохрани.');
  };
  $('saveRecord').onclick = () => {
    if (!recorded.length) { toast('Сначала запиши действия'); return; }
    const name = $('recordName').value.trim() || `Chrome запись ${new Date().toLocaleString('ru-RU')}`;
    const list = scenarios();
    const entry = {id: crypto.randomUUID(), name, startUrl: selectedTab?.url || '', steps: recorded, variables: {}, createdAt: new Date().toISOString()};
    list.unshift(entry); localStorage.setItem(STORE, JSON.stringify(list.slice(0, 50)));
    refreshScenarios(); $('scenarioPick').value = entry.id; refreshScenarios(); toast('Сценарий сохранён в этом браузере');
  };
  refreshScenarios(); refreshStatus(); setInterval(() => { if (!playing) refreshStatus(); }, 3000);
})();
