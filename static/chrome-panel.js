(() => {
  const $ = id => document.getElementById(id);
  const STORE = 'katya_scenarios_v1';
  const pending = new Map();
  let tab = null, playing = false, cancelled = false, recorded = [], recording = false;
  let shotBusy = false, lastShotAt = 0, dragging = false, lastMoveAt = 0;
  let inputQueue = Promise.resolve(), lastInputError = '';
  let lastVideoTime = null, lastVideoAt = 0;
  let selectedStep = null, failedStep = null, media = null;

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'katya-extension') return;
    const request = pending.get(event.data.id);
    if (!request) return;
    clearTimeout(request.timer); pending.delete(event.data.id); request.resolve(event.data.reply);
  });
  function bridge(command, payload = {}) {
    return new Promise(resolve => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { pending.delete(id); resolve({ok: false, error: 'Расширение не отвечает. Установите его и обновите страницу.'}); }, command === 'execute' ? 35000 : command === 'screenshot' ? 12000 : 5000);
      pending.set(id, {resolve, timer});
      window.postMessage({source: 'katya-dashboard', id, command, payload}, location.origin);
    });
  }
  function scenarios() { try { const data = JSON.parse(localStorage.getItem(STORE) || '[]'); return Array.isArray(data) ? data : []; } catch { return []; } }
  function source() {
    return startSource();
  }
  function stepLabel(step) {
    if (typeof describeStep === 'function') return step.name ? `${describeStep({...step, query: ''}).split(':')[0]}: ${step.name}` : describeStep(step);
    const value = step.query || (['fill', 'type'].includes(step.action) ? '' : step.value);
    return `${step.action}${value ? ' · ' + String(value).slice(0, 80) : ''}`;
  }
  function renderSteps(steps, target) {
    if (target.id === 'chromeStepList') {
      BrowserCore.renderTimeline(target, steps, stepLabel);
      [...target.children].forEach((li, index) => { li.tabIndex = 0; li.setAttribute('role', 'button'); li.classList.toggle('selected', selectedStep === index); li.classList.toggle('failed', failedStep === index); });
      return;
    }
    target.replaceChildren(...steps.map((step, index) => {
      const li = document.createElement('li'); li.dataset.index = index + 1; li.textContent = stepLabel(step); li.title = step.query ? `${step.action} · ${step.query}` : step.action;
      return li;
    }));
  }
  function showScenarioButton() {
    const steps = source()?.steps || [];
    if ($('launchMethod').value === 'chrome') $('btnStart').textContent = steps.length ? selectedStep === null ? 'Запустить сценарий' : `Запустить с шага ${selectedStep + 1}` : 'Открыть в Chrome';
  }
  function selectStep(index) {
    selectedStep = selectedStep === index ? null : index;
    BrowserCore.markTimeline($('chromeStepList'), {selected: selectedStep ?? -1, failed: failedStep ?? -1});
    $('chromeStepActions').hidden = selectedStep === null;
    if (selectedStep !== null) $('chromeSelectedStep').textContent = `Шаг ${selectedStep + 1} · ${stepLabel(source()?.steps?.[selectedStep] || {})}`;
    showScenarioButton();
  }
  function showScenario() {
    const steps = source()?.steps || [];
    selectedStep = null; failedStep = null; $('chromeStepActions').hidden = true;
    $('chromeStepCount').textContent = `${steps.length} шагов`;
    $('chromeScenarioSummary').hidden = !steps.length;
    $('chromeScenarioStatus').textContent = steps.length ? `Готово · 0/${steps.length}` : '';
    $('chromeScenarioNow').textContent = steps.length ? 'Выбери действие или запусти с начала' : '';
    $('chromeScenarioTrack').style.width = '0%';
    renderSteps(steps, $('chromeStepList'));
    showScenarioButton();
  }
  function runState(text, status = '') { $('chromeRunState').hidden = false; $('chromeRunState').textContent = text; $('chromeRunState').className = 'chrome-run-state ' + status; }
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
    document.querySelectorAll('.method-switch button').forEach(button => {
      const active = button.dataset.method === $('launchMethod').value;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
    $('btnStop').disabled = chromeMode ? !playing : !curJob;
    $('scenarioHint').textContent = chromeMode ? 'Сценарий начнётся через 10 секунд. Выбери шаг справа, чтобы продолжить с него.' : 'Вкладка откроет адрес и сразу выполнит сохранённые шаги. Повторы — в поле справа от «Повторить».';
    $('btnStart').textContent = chromeMode ? 'Открыть в Chrome' : 'Запустить';
    showScenario();
    if (chromeMode) refreshStatus();
  }
  async function refreshStatus() {
    const result = await bridge('status');
    const needsUpdate = result.ok && result.version !== '0.3.0';
    const badge = $('bridgeStatus');
    badge.classList.toggle('err', !result.ok || needsUpdate);
    badge.textContent = needsUpdate ? '● Обновите расширение до 0.3.0' : result.ok ? (result.tab ? '● Chrome подключён' : '● Расширение установлено') : '● Расширение не найдено';
    tab = needsUpdate ? null : result.tab || null;
    $('connectedTab').textContent = tab ? `${tab.title || 'Вкладка'} · ${tab.url}` : 'Вкладка не подключена';
    $('chromeDetach').disabled = !tab;
    $('chromeShotEmpty').textContent = needsUpdate ? 'Обновите расширение — инструкция слева' : !result.ok ? 'Установите расширение — инструкция слева' : 'Введите адрес слева и нажмите «Открыть в Chrome»';
    if (!tab) {
      $('chromeShotImage').hidden = true; $('chromeShotImage').removeAttribute('src');
      $('chromeShotFrame').classList.add('empty');
      $('chromeMediaState').hidden = true;
      $('chromeVideoControls').hidden = true; media = null;
    } else if ($('chromeShotImage').hidden && !shotBusy) shot(true);
    if ($('launchMethod').value === 'chrome') $('heroWorkers').textContent = tab ? '1' : '0';
    if ((!result.ok || needsUpdate) && $('launchMethod').value === 'chrome') $('chromeSetup').querySelector('.chrome-install').open = true;
    if (result.ok) {
      recording = !!result.recording;
      $('chromeEventCount').textContent = `${result.events || 0} действий`;
      $('chromeRecord').disabled = recording;
      $('chromeFinish').disabled = !recording;
    }
  }
  async function loadTabs() {
    const list = $('chromeTabList');
    list.textContent = 'Ищу вкладки…';
    const result = await bridge('tabs');
    if (!result.ok) { list.textContent = result.error || 'Не удалось получить вкладки'; return; }
    if (!result.tabs?.length) { list.textContent = 'Других открытых вкладок нет'; return; }
    list.replaceChildren(...result.tabs.map(entry => {
      const button = document.createElement('button'); button.type = 'button';
      const title = document.createElement('b'); title.textContent = entry.title || 'Вкладка';
      const url = document.createElement('small'); url.textContent = entry.url || '';
      button.append(title, url);
      button.onclick = async () => {
        const attached = await bridge('attach', {tabId: entry.id});
        if (!attached.ok) { toast(attached.error, 'err'); return; }
        $('chromeTabPicker').open = false;
        await refreshStatus();
      };
      return button;
    }));
  }
  async function refreshMedia() {
    if (!tab || $('launchMethod').value !== 'chrome') return;
    const result = await bridge('media');
    const box = $('chromeMediaState');
    if (!result.ok || !result.media?.video) { box.hidden = true; $('chromeVideoControls').hidden = true; media = null; lastVideoTime = null; return; }
    const {video, visibility} = result.media;
    media = video;
    $('chromeVideoControls').hidden = false;
    $('chromeVideoPlay').textContent = video.paused ? '▶' : 'Ⅱ';
    const seek = $('chromeVideoSeek');
    seek.max = String(Math.max(1, Math.floor(video.duration || 1)));
    if (!seek.matches(':active')) seek.value = String(Math.floor(video.currentTime || 0));
    const stamp = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
    $('chromeVideoTime').textContent = `${stamp(video.currentTime || 0)} / ${stamp(video.duration || 0)}`;
    const now = Date.now();
    const moving = lastVideoTime !== null && video.currentTime > lastVideoTime + 0.2;
    if (moving) lastVideoAt = now;
    else if (lastVideoTime === null) lastVideoAt = now;
    lastVideoTime = video.currentTime;
    let text = moving ? `Видео играет · ${video.currentTime.toFixed(1)} с` : video.paused ? 'Видео на паузе — нажмите Play прямо в кадре' : video.readyState < 3 ? 'Плеер ждёт загрузки видео' : 'Проверяю воспроизведение…';
    if (!moving && !video.paused && now - lastVideoAt > 6000) text = 'Видео не движется';
    if (visibility === 'hidden') text += ' · вкладка скрыта';
    box.replaceChildren(document.createTextNode(text));
    if (visibility === 'hidden' && !moving && now - lastVideoAt > 6000) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Открыть в отдельном окне';
      button.onclick = async () => { const r = await bridge('promote'); if (!r.ok) toast(r.error, 'err'); else { toast('Вкладка перенесена в отдельное окно'); shot(true); } };
      box.append(button);
    }
    box.hidden = false;
  }
  async function shot(silent = false) {
    if (!tab || shotBusy || $('launchMethod').value !== 'chrome') return;
    shotBusy = true;
    try {
      const result = await bridge('screenshot');
      if (!result.ok) throw new Error(result.error || 'Нет кадра');
      const next = new Image(); next.src = result.image;
      await next.decode();
      if (!tab) return;
      $('chromeShotImage').src = result.image;
      $('chromeShotImage').hidden = false;
      $('chromeShotFrame').classList.remove('empty');
      lastShotAt = Date.now();
    } catch (error) {
      if (!silent) toast(error.message, 'err');
      if ($('chromeShotImage').hidden) $('chromeShotEmpty').textContent = error.message;
    } finally { shotBusy = false; }
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
    const from = selectedStep || 0;
    $('btnStart').disabled = true;
    try {
      if (!tab || (from === 0 && tab.url !== url)) {
        const opened = await bridge('open', {url});
        if (!opened.ok) throw new Error(opened.error || 'Не удалось открыть вкладку');
        tab = opened.tab;
      }
      await refreshStatus();
      if (!selected?.steps?.length) { runState('Вкладка открыта · можно записывать действия'); return; }
      playing = true; cancelled = false; $('btnStop').disabled = false;
      const items = [...$('chromeStepList').children];
      failedStep = null;
      const result = await BrowserCore.run({steps: selected.steps, from, repeats: repeat,
        shouldStop: () => cancelled,
        onRepeat: async pass => {
          if (pass > 0) {
            runState(`Повтор ${pass + 1}/${repeat} · открываю страницу`, 'running');
            const next = await bridge('execute', {step: {action: 'navigate', value: url}});
            if (!next.ok) throw new Error(next.error || 'Не удалось открыть страницу');
          }
          if (pass === 0) await pause(10000);
        },
        onStep: async (i, pass, step) => {
          BrowserCore.markTimeline($('chromeStepList'), {current:i,completed:i,selected:from});
          $('chromeScenarioStatus').textContent = `Выполняется · ${i}/${selected.steps.length}`;
          $('chromeScenarioNow').textContent = `Шаг ${i + 1}: ${stepLabel(step)}`;
          $('chromeScenarioTrack').style.width = `${i / selected.steps.length * 100}%`;
          items[i]?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
          runState(`Повтор ${pass + 1}/${repeat} · шаг ${i + 1}/${selected.steps.length} · ${stepLabel(step)}`, 'running');
        },
        execute: async raw => {
          let step;
          try { step = substitute(raw, selected); } catch (error) { return {ok: false, error: error.message}; }
          if (step.action === 'wait') { await pause(Math.min(60000, Math.max(0, Number(step.value || step.duration_ms) || 0))); return {ok: !cancelled}; }
          if (step.action === 'screenshot') { await shot(); return {ok: true}; }
          return bridge('execute', {step});
        }});
      if (!result.ok && !result.stopped) {
        failedStep = result.index; selectedStep = result.index; items[result.index]?.classList.add('failed');
        BrowserCore.markTimeline($('chromeStepList'), {completed: result.index,failed:result.index,selected:result.index});
        $('chromeScenarioStatus').textContent = `Ошибка · ${result.index}/${selected.steps.length}`;
        $('chromeScenarioNow').textContent = `Ошибка на шаге ${result.index + 1}: ${result.error}`;
        $('chromeStepActions').hidden = false;
        $('chromeSelectedStep').textContent = `Ошибка на шаге ${result.index + 1} · ${stepLabel(selected.steps[result.index])}`;
        showScenarioButton();
        throw new Error(`Шаг ${result.index + 1}: ${result.error}`);
      }
      runState(cancelled ? 'Остановлено' : `Готово · ${result.completed} повторов`);
      items.forEach(li => li.classList.remove('current'));
      if (!cancelled) items.forEach((li, i) => li.classList.toggle('done', i >= from));
      $('chromeScenarioStatus').textContent = cancelled ? 'Остановлено' : `Готово · ${selected.steps.length}/${selected.steps.length}`;
      $('chromeScenarioNow').textContent = cancelled ? 'Выполнение остановлено' : 'Сценарий выполнен';
      $('chromeScenarioTrack').style.width = cancelled ? $('chromeScenarioTrack').style.width : '100%';
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
  function coordinates(event) {
    const image = $('chromeShotImage');
    const rect = image.getBoundingClientRect();
    return {x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))};
  }
  function input(payload) {
    inputQueue = inputQueue.then(async () => {
      const result = await bridge('input', payload);
      if (!result.ok) throw new Error(result.error || 'Нет ответа от вкладки');
      lastInputError = '';
    }).catch(error => {
      if (error.message !== lastInputError) { lastInputError = error.message; toast(error.message, 'err'); }
    });
    return inputQueue;
  }
  const frame = $('chromeShotFrame');
  function interactive() { return tab && !$('chromeShotImage').hidden && $('launchMethod').value === 'chrome'; }
  frame.addEventListener('pointerdown', event => {
    if (!interactive() || event.button !== 0) return;
    event.preventDefault(); frame.focus({preventScroll: true}); frame.setPointerCapture(event.pointerId);
    dragging = true; input({type: 'down', ...coordinates(event)});
  });
  frame.addEventListener('pointermove', event => {
    if (!interactive() || Date.now() - lastMoveAt < (dragging ? 24 : 60)) return;
    lastMoveAt = Date.now(); input({type: 'move', dragging, ...coordinates(event)});
  });
  function release(event) {
    if (!dragging || !interactive()) return;
    event.preventDefault(); dragging = false;
    input({type: 'up', ...coordinates(event)}).then(() => setTimeout(() => shot(true), 120));
  }
  frame.addEventListener('pointerup', release);
  frame.addEventListener('pointercancel', release);
  frame.addEventListener('wheel', event => {
    if (!interactive()) return;
    event.preventDefault();
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
    input({type: 'wheel', ...coordinates(event), deltaX: event.deltaX * scale, deltaY: event.deltaY * scale}).then(() => setTimeout(() => shot(true), 140));
  }, {passive: false});
  frame.addEventListener('keydown', event => {
    if (!interactive() || event.isComposing) return;
    event.preventDefault();
    const modifiers = (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
    if (event.key.length === 1 && !(event.altKey || event.ctrlKey || event.metaKey)) input({type: 'text', text: event.key});
    else input({type: 'key', key: event.key, code: event.code, modifiers});
    setTimeout(() => shot(true), 160);
  });
  frame.addEventListener('paste', event => {
    if (!interactive()) return;
    event.preventDefault(); input({type: 'text', text: event.clipboardData?.getData('text/plain') || ''}).then(() => setTimeout(() => shot(true), 160));
  });
  $('chromeDetach').onclick = async () => { const r = await bridge('detach'); if (!r.ok) toast(r.error, 'err'); await refreshStatus(); };
  $('chromeStepList').addEventListener('click', event => { const li = event.target.closest('li[data-step-index]'); if (li && !playing) selectStep(Number(li.dataset.stepIndex)); });
  $('chromeStepList').addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.target.click(); } });
  $('chromeRunFrom').onclick = start;
  $('chromeClearStep').onclick = () => selectStep(selectedStep);
  async function mediaAction(type, time) {
    const result = await bridge('media-action', {type, time});
    if (!result.ok) toast(result.error || 'Видео не ответило', 'err');
    await refreshMedia();
    shot(true);
  }
  $('chromeVideoPlay').onclick = () => mediaAction(media?.paused ? 'play' : 'pause');
  $('chromeVideoBack').onclick = () => mediaAction('seek', Math.max(0, (media?.currentTime || 0) - 10));
  $('chromeVideoForward').onclick = () => mediaAction('seek', (media?.currentTime || 0) + 10);
  $('chromeVideoSeek').addEventListener('change', event => mediaAction('seek', Number(event.target.value)));
  $('chromeManualRun').onclick = async () => {
    const step = {action: $('chromeManualAction').value, kind: $('chromeManualKind').value, query: $('chromeManualQuery').value.trim(), value: $('chromeManualValue').value.trim()};
    if (['click', 'wait_click', 'fill', 'type', 'hover', 'dblclick', 'select', 'wait_for', 'wait_gone', 'text'].includes(step.action) && !step.query) { toast('Укажи элемент', 'err'); return; }
    if (step.action === 'screenshot') { await shot(); runState('Кадр обновлён'); return; }
    if (!tab) { toast('Сначала подключи вкладку Chrome', 'err'); return; }
    $('chromeManualRun').disabled = true;
    try {
      const result = await bridge('execute', {step});
      if (!result.ok) throw new Error(result.error || 'Действие не выполнено');
      runState(step.action === 'text' ? `Текст: ${result.value || 'пусто'}` : `Выполнено · ${stepLabel(step)}`);
      shot(true);
    } catch (error) { runState(error.message, 'err'); toast(error.message, 'err'); }
    finally { $('chromeManualRun').disabled = false; }
  };
  $('chromeTabPicker').addEventListener('toggle', () => { if ($('chromeTabPicker').open) loadTabs(); });
  $('chromeRecord').onclick = async () => {
    const r = await bridge('record', {enabled: true});
    if (!r.ok) { toast(r.error, 'err'); return; }
    recorded = []; recording = true; $('chromeRecord').disabled = true; $('chromeFinish').disabled = false;
    $('chromeRecordedList').replaceChildren(); $('chromeRecordedList').hidden = true; runState('Запись идёт · действуй в кадре справа', 'running');
  };
  $('chromeFinish').onclick = async () => {
    await bridge('record', {enabled: false});
    const r = await bridge('events');
    if (!r.ok) { toast(r.error, 'err'); return; }
    recorded = eventsToSteps(r.events || []);
    renderSteps(recorded, $('chromeRecordedList')); $('chromeRecordedList').hidden = !recorded.length; $('chromeRecordedList').closest('#chromeWorkspace').querySelector('.chrome-save').hidden = !recorded.length;
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
  document.querySelectorAll('.method-switch button').forEach(button => button.addEventListener('click', () => {
    $('launchMethod').value = button.dataset.method;
    $('launchMethod').dispatchEvent(new Event('change', {bubbles: true}));
  }));
  const requested = new URLSearchParams(location.search).get('method');
  $('launchMethod').value = requested === 'chrome' ? 'chrome' : localStorage.getItem('katya_launch_method') || 'playwright';
  document.querySelector('#chromeWorkspace .chrome-save').hidden = true;
  setMode(); showScenario();
  setInterval(() => { if ($('launchMethod').value === 'chrome' && !playing) refreshStatus(); }, 3000);
  setInterval(refreshMedia, 3000);
  setInterval(() => { if ($('launchMethod').value === 'chrome' && tab && document.visibilityState === 'visible' && Date.now() - lastShotAt > 650) shot(true); }, 700);
  window.chromePanel = {start, stop, refresh: refreshStatus, get playing() { return playing; }};
})();
