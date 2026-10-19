(() => {
  const $ = id => document.getElementById(id);
  const STORE = 'katya_scenarios_v1';
  $('chromeScenarioMount').innerHTML = BrowserCore.scenarioTemplate(true);
  const panel = $('chromeScenarioMount').querySelector('.scenario-panel');
  const pending = new Map();
  let tab = null, playing = false, cancelled = false, recorded = [], recording = false;
  let draftActive = false;
  let shotBusy = false, shotUrgent = false, shotTimer = null, lastActivityAt = 0, dragging = false, lastMoveAt = 0;
  let inputQueue = Promise.resolve(), lastInputError = '';
  let lastVideoTime = null, lastVideoAt = 0;
  let selectedStep = null, failedStep = null, media = null;
  let extensionDirectory = null;

  function extensionStore() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('katya-extension-updater', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('handles');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function savedExtensionDirectory() {
    const db = await extensionStore();
    return new Promise((resolve, reject) => {
      const request = db.transaction('handles').objectStore('handles').get('extension');
      request.onsuccess = () => { resolve(request.result || null); db.close(); };
      request.onerror = () => { reject(request.error); db.close(); };
    });
  }
  async function rememberExtensionDirectory(handle) {
    const db = await extensionStore();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('handles', 'readwrite');
      transaction.objectStore('handles').put(handle, 'extension');
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    });
  }
  savedExtensionDirectory().then(handle => { extensionDirectory = handle; }).catch(() => {});

  $('chromeUpdateExtension').onclick = async () => {
    const button = $('chromeUpdateExtension'), status = $('chromeUpdateStatus');
    if (button.disabled) return;
    try {
      if (!window.showDirectoryPicker) throw new Error('Обновление папки доступно в Chrome.');
      let handle = extensionDirectory;
      if (!handle) handle = await window.showDirectoryPicker({id: 'katya-extension', mode: 'readwrite'});
      else if ((await handle.requestPermission({mode: 'readwrite'})) !== 'granted') throw new Error('Нужен доступ к папке расширения.');
      button.disabled = true;
      status.textContent = 'Проверяю папку и загружаю обновление…';
      const installed = JSON.parse(await (await (await handle.getFileHandle('manifest.json')).getFile()).text());
      if (installed.name !== 'Katya Browser Bridge') {
        extensionDirectory = null;
        await rememberExtensionDirectory(null);
        throw new Error('Выбрана другая папка. Нажмите кнопку снова и выберите папку Katya Browser Bridge.');
      }
      const response = await fetch('/api/extension-bundle', {cache: 'no-store'});
      if (!response.ok) throw new Error('Не удалось получить обновление с сервера.');
      const bundle = await response.json();
      if (!bundle.ok || !bundle.files?.['manifest.json'] || !bundle.version) throw new Error('Неверный пакет обновления.');
      for (const [name, contents] of Object.entries(bundle.files)) {
        if (!/^[\w.-]+$/.test(name) || typeof contents !== 'string') throw new Error('Неверный файл в пакете обновления.');
        const file = await handle.getFileHandle(name, {create: true});
        const writer = await file.createWritable();
        await writer.write(contents); await writer.close();
      }
      extensionDirectory = handle;
      await rememberExtensionDirectory(handle);
      const result = await bridge('reload-extension');
      if (!result.ok) {
        status.textContent = `Файлы версии ${bundle.version} установлены. Один раз нажмите «Обновить» на chrome://extensions.`;
      } else {
        status.textContent = `Версия ${bundle.version} установлена. Подключение восстанавливается…`;
        setTimeout(refreshStatus, 1800);
      }
    } catch (error) {
      if (error.name !== 'AbortError') status.textContent = error.message || 'Не удалось обновить расширение.';
    } finally { button.disabled = false; }
  };

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
    return draftActive && recorded.length ? {steps: recorded, variables: {}, startUrl: $('url').value.trim()} : startSource();
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
    $('chromeStepChips').querySelectorAll('li').forEach((li, i) => li.classList.toggle('picked', selectedStep === i));
    $('chromeStepActions').hidden = selectedStep === null;
    if (selectedStep !== null) $('chromeSelectedStep').textContent = `Шаг ${selectedStep + 1} · ${stepLabel(source()?.steps?.[selectedStep] || {})}`;
    if (selectedStep !== null) $('chromeScenarioNow').textContent = `Начать с шага ${selectedStep + 1}: ${stepLabel(source()?.steps?.[selectedStep] || {})}`;
    $('chromeReplay').textContent = selectedStep === null ? '▶ Повторить' : `▶ С шага ${selectedStep + 1}`;
    BrowserCore.renderStepEditor($('chromeStepEditor'), selectedStep === null ? null : source()?.steps?.[selectedStep], selectedStep, next => updateSelectedStep(steps => { steps[selectedStep] = next; }), () => updateSelectedStep(steps => { steps.splice(selectedStep, 1); }));
    BrowserCore.mountStepEditor($('chromeStepList'), $('chromeStepEditor'), selectedStep);
    showScenarioButton();
  }
  function updateSelectedStep(change) {
    const current = source(); if (!current?.steps?.length) return;
    const steps = structuredClone(current.steps); change(steps);
    const choice = $('startScenario').value;
    if (draftActive || !choice.startsWith('scenario:')) {
      recorded = steps; draftActive = true;
      if (!choice.startsWith('scenario:')) toast('Изменённая копия готова. Нажми «Сохранить» для нового сценария.');
    } else {
      const items = scenarios(), item = items.find(s => s.id === choice.slice(9));
      if (item) { item.steps = steps; localStorage.setItem(STORE, JSON.stringify(items)); fillStartScenario(); $('startScenario').value = choice; fillMacroPick($('chromeMacroPick')); }
    }
    const nextIndex = selectedStep;
    showScenario();
    if (steps.length && nextIndex !== null) selectStep(Math.min(nextIndex, steps.length - 1));
    runState('Шаг изменён и сохранён', 'ok');
  }
  function showScenario() {
    const steps = source()?.steps || [];
    selectedStep = null; failedStep = null; $('chromeStepActions').hidden = true;
    BrowserCore.mountStepEditor($('chromeStepList'), $('chromeStepEditor'), null);
    BrowserCore.renderStepEditor($('chromeStepEditor'), null);
    $('chromeStepCount').textContent = `${steps.length} шагов`;
    $('chromeScenarioSummary').hidden = !steps.length;
    $('chromeScenarioStatus').textContent = steps.length ? `Готов к запуску · 0/${steps.length}` : '';
    $('chromeScenarioNow').textContent = steps.length ? 'Выбери действие или запусти с начала' : '';
    $('chromeScenarioTrack').style.width = '0%';
    $('chromeReplay').textContent = '▶ Повторить';
    $('chromeRecordedList').hidden = true;
    BrowserCore.renderChips($('chromeStepChips'), steps, stepLabel);
    renderSteps(steps, $('chromeStepList'));
    BrowserCore.renderLibrary(panel.querySelector('.scenario-library-list'), [
      ...scenarios().filter(item => item.steps?.length).map(item => ({...item, choice:`scenario:${item.id}`})),
      ...MACROS.filter(item => !scenarios().some(local => local.name === item.name)).map(item => ({...item, choice:`macro:${item.name}`}))
    ], item => { draftActive=false; recorded=[]; $('startScenario').value=item.choice; applyScenarioSettings(); showScenario(); panel.querySelector('.scenario-library').open=false; },
    item => deleteScenarioChoice(item.choice, item),
    (item,name) => { const items=scenarios(); const found=items.find(s=>s.id===item.id); if(found){found.name=name;localStorage.setItem(STORE,JSON.stringify(items));fillStartScenario();showScenario();} });
    showScenarioButton();
  }
  async function deleteScenarioChoice(choice, item) {
    if (!confirm(`Удалить сценарий «${item.name}»?`)) return;
    if (choice.startsWith('scenario:')) localStorage.setItem(STORE,JSON.stringify(scenarios().filter(s=>s.id!==item.id)));
    else { const result=await apiFetch(`/api/macros/${encodeURIComponent(item.name)}`,{method:'DELETE'}); if(!result.ok){toast(result.error||'Не удалось удалить','err');return;} await loadMacros(); }
    if($('startScenario').value===choice){$('startScenario').value='';draftActive=false;recorded=[];}
    fillStartScenario(); fillMacroPick($('chromeMacroPick')); showScenario(); toast('Сценарий удалён');
  }
  function runState(text, status = '') { $('chromeRunState').textContent = text; $('chromeRunState').className = 'record-status ' + status; }
  function setMode() {
    const chromeMode = $('launchMethod').value === 'chrome';
    localStorage.setItem('katya_launch_method', $('launchMethod').value);
    $('chromeSetup').hidden = !chromeMode;
    $('chromeWorkspace').hidden = !chromeMode;
    $('serverWorkspace').hidden = chromeMode;
    $('logBox').hidden = chromeMode;
    $('autoCard').hidden = chromeMode;
    document.querySelectorAll('.server-only').forEach(el => el.hidden = chromeMode);
    document.querySelectorAll('.method-switch button').forEach(button => {
      const active = button.dataset.method === $('launchMethod').value;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
    $('btnStop').disabled = chromeMode ? !playing : !curJob;
    $('scenarioHint').textContent = chromeMode ? 'После открытия или перезагрузки страницы сценарий подождёт до 3 секунд. В уже открытой вкладке запуск с выбранного шага — сразу.' : 'Вкладка откроет адрес и сразу выполнит сохранённые шаги. Повторы — в поле справа от «Повторить».';
    $('btnStart').textContent = chromeMode ? 'Открыть в Chrome' : 'Запустить';
    showScenario();
    if (chromeMode) refreshStatus();
    else clearTimeout(shotTimer);
  }
  async function refreshStatus() {
    const result = await bridge('status');
    const needsUpdate = result.ok && result.version !== '0.5.1';
    const badge = $('bridgeStatus');
    badge.classList.toggle('err', !result.ok || needsUpdate);
    badge.textContent = needsUpdate ? '● Обновите расширение до 0.5.1' : result.ok ? (result.tab ? '● Chrome подключён' : '● Расширение установлено') : '● Расширение не найдено';
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
    if ((!result.ok || needsUpdate) && $('launchMethod').value === 'chrome') $('chromeSetup').querySelector('.chrome-install').open = true;
    if (result.ok) {
      recording = !!result.recording;
      $('chromeRecord').classList.toggle('recording', recording);
      $('chromeRecord').textContent = recording ? '■ Остановить запись' : '● Записать шаги';
      if (recording) runState(`● Запись идёт · ${result.events || 0} действий`,'running');
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
    if (!tab || $('launchMethod').value !== 'chrome' || document.visibilityState !== 'visible') return;
    if (shotBusy) { shotUrgent = true; return; }
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
    } catch (error) {
      if (!silent) toast(error.message, 'err');
      if ($('chromeShotImage').hidden) $('chromeShotEmpty').textContent = error.message;
    } finally {
      shotBusy = false;
      clearTimeout(shotTimer);
      if (tab && $('launchMethod').value === 'chrome' && document.visibilityState === 'visible') {
        const active = recording || Date.now() - lastActivityAt < 5000;
        shotTimer = setTimeout(() => shot(true), shotUrgent ? 180 : active ? 280 : 1200);
      }
      shotUrgent = false;
    }
  }
  function wakeShot() {
    lastActivityAt = Date.now();
    if (shotBusy) shotUrgent = true;
    else { clearTimeout(shotTimer); shotTimer = setTimeout(() => shot(true), 0); }
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
    const repeat = Number($('chromeRepeatCount').value);
    if (selected?.steps?.length && (!Number.isInteger(repeat) || repeat < 1 || repeat > 100)) { toast('Повторов должно быть от 1 до 100', 'err'); return; }
    const from = selectedStep || 0;
    $('btnStart').disabled = true;
    try {
      let pageOpened = false;
      if (!tab || (from === 0 && tab.url !== url)) {
        const opened = await bridge('open', {url});
        if (!opened.ok) throw new Error(opened.error || 'Не удалось открыть вкладку');
        tab = opened.tab;
        pageOpened = true;
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
          if (pass > 0 || pageOpened) await pause(3000);
        },
        onStep: async (i, pass, step) => {
          BrowserCore.markTimeline($('chromeStepList'), {current:i,completed:i,selected:from});
          $('chromeStepChips').querySelectorAll('li').forEach((li, index) => { li.classList.toggle('current', index === i); li.classList.toggle('done', index >= from && index < i); li.classList.remove('failed'); });
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
          const result = await bridge('execute', {step});
          wakeShot();
          return result;
        }});
      if (!result.ok && !result.stopped) {
        failedStep = result.index; selectedStep = result.index; items[result.index]?.classList.add('failed');
        BrowserCore.markTimeline($('chromeStepList'), {completed: result.index,failed:result.index,selected:result.index});
        $('chromeStepChips').querySelectorAll('li').forEach((li, index) => { li.classList.toggle('failed', index === result.index); li.classList.toggle('done', index >= from && index < result.index); li.classList.remove('current'); });
        $('chromeScenarioStatus').textContent = `Ошибка · ${result.index}/${selected.steps.length}`;
        $('chromeScenarioNow').textContent = `Ошибка на шаге ${result.index + 1}: ${result.error}`;
        $('chromeStepActions').hidden = false;
        $('chromeSelectedStep').textContent = `Ошибка на шаге ${result.index + 1} · ${stepLabel(selected.steps[result.index])}`;
        showScenarioButton();
        throw new Error(`Шаг ${result.index + 1}: ${result.error}`);
      }
      runState(cancelled ? 'Остановлено' : `Готово · ${result.completed} ${result.completed === 1 ? 'повтор' : 'повторов'}`);
      items.forEach(li => li.classList.remove('current'));
      if (!cancelled) items.forEach((li, i) => li.classList.toggle('done', i >= from));
      $('chromeStepChips').querySelectorAll('li').forEach((li, i) => { li.classList.remove('current'); if (!cancelled) li.classList.toggle('done', i >= from); });
      $('chromeScenarioStatus').textContent = cancelled ? 'Остановлено' : from ? `Готово · с шага ${from + 1}` : `Готово · ${selected.steps.length}/${selected.steps.length}`;
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
      wakeShot();
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
    input({type: 'up', ...coordinates(event)}).then(() => shot(true));
  }
  frame.addEventListener('pointerup', release);
  frame.addEventListener('pointercancel', release);
  frame.addEventListener('wheel', event => {
    if (!interactive()) return;
    event.preventDefault();
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
    input({type: 'wheel', ...coordinates(event), deltaX: event.deltaX * scale, deltaY: event.deltaY * scale}).then(() => shot(true));
  }, {passive: false});
  frame.addEventListener('keydown', event => {
    if (!interactive() || event.isComposing) return;
    event.preventDefault();
    const modifiers = (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
    if (event.key.length === 1 && !(event.altKey || event.ctrlKey || event.metaKey)) input({type: 'text', text: event.key}).then(() => shot(true));
    else input({type: 'key', key: event.key, code: event.code, modifiers}).then(() => shot(true));
  });
  frame.addEventListener('paste', event => {
    if (!interactive()) return;
    event.preventDefault(); input({type: 'text', text: event.clipboardData?.getData('text/plain') || ''}).then(() => shot(true));
  });
  $('chromeDetach').onclick = async () => { const r = await bridge('detach'); if (!r.ok) toast(r.error, 'err'); await refreshStatus(); };
  $('chromeStepList').addEventListener('click', event => { if (event.target.closest('.scenario-step-editor')) return; const li = event.target.closest('li[data-step-index]'); if (li && !playing) selectStep(Number(li.dataset.stepIndex)); });
  $('chromeStepList').addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.target.click(); } });
  $('chromeStepChips').addEventListener('click', event => { const li = event.target.closest('li[data-step-index]'); if (li && !playing) selectStep(Number(li.dataset.stepIndex)); });
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
  function updateManualFields() {
    const action = $('chromeManualAction').value;
    $('chromeManualValue').hidden = !['fill','type','drag','scroll','press','navigate','select','wait','screenshot'].includes(action);
    $('chromeManualQuery').hidden = ['navigate','reload','back','wait','press','screenshot','point'].includes(action);
    $('chromeManualKind').hidden = $('chromeManualQuery').hidden;
    $('chromeManualX').hidden = action !== 'point';
    $('chromeManualY').hidden = action !== 'point';
  }
  $('chromeManualAction').addEventListener('change', updateManualFields);
  updateManualFields();
  $('chromeManualRun').onclick = async () => {
    const step = {action: $('chromeManualAction').value, kind: $('chromeManualKind').value, query: $('chromeManualQuery').value.trim(), value: $('chromeManualValue').value.trim(), x:Number($('chromeManualX').value)/100, y:Number($('chromeManualY').value)/100};
    if(step.action === 'point' && (!$('chromeManualX').value.trim() || !$('chromeManualY').value.trim() || !Number.isFinite(step.x) || !Number.isFinite(step.y) || step.x < 0 || step.x > 1 || step.y < 0 || step.y > 1)){toast('Укажи координаты от 0 до 100%', 'err');return;}
    if (['click', 'wait_click', 'fill', 'type', 'hover', 'dblclick', 'select', 'wait_for', 'wait_gone', 'text'].includes(step.action) && !step.query) { toast('Укажи элемент', 'err'); return; }
    if (step.action === 'screenshot') { await shot(); runState('Кадр обновлён'); return; }
    if (step.action === 'wait') { await pause(Math.min(60000, Math.max(0, Number(step.value) || 0))); return; }
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
    if (!recording) {
      const r = await bridge('record', {enabled: true});
      if (!r.ok) { toast(r.error, 'err'); return; }
      recorded = []; draftActive = false; recording = true;
      wakeShot();
      $('chromeRecord').classList.add('recording'); $('chromeRecord').textContent = '■ Остановить запись';
      $('chromeRecordedList').replaceChildren(); runState('● Запись идёт · действия появятся после остановки', 'running');
      return;
    }
    const stopped = await bridge('record', {enabled: false});
    if (!stopped.ok) { toast(stopped.error, 'err'); return; }
    const r = await bridge('events');
    if (!r.ok) { toast(r.error, 'err'); return; }
    recorded = eventsToSteps(r.events || []); draftActive = recorded.length > 0; recording = false;
    wakeShot();
    $('chromeRecord').classList.remove('recording'); $('chromeRecord').textContent = '● Записать шаги';
    showScenario();
    runState(recorded.length ? `${recorded.length} шагов · нажми «Сохранить» или «Повторить»` : 'Запись остановлена · действий нет');
  };
  $('chromeSave').onclick = () => {
    if (!recorded.length) { toast('Сначала запиши действия', 'err'); return; }
    const host = (() => { try { return new URL($('url').value.trim()).hostname.replace(/^www\./, ''); } catch { return 'Chrome'; } })();
    const name = `${host} · ${recorded.length} шагов · ${new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'})}`;
    const item = {id: crypto.randomUUID(), name, startUrl: $('url').value.trim(), steps: recorded, variables: {}, createdAt: new Date().toISOString()};
    localStorage.setItem(STORE, JSON.stringify([item, ...scenarios()].slice(0, 50)));
    draftActive = false; recorded = []; $('chromeRecordedList').replaceChildren();
    fillStartScenario(); fillMacroPick($('chromeMacroPick')); $('startScenario').value = `scenario:${item.id}`; applyScenarioSettings(); showScenario();
    toast('Сценарий сохранён в этом браузере');
  };
  $('chromeReplay').onclick = () => { if (playing) return stop(); start(); };
  $('chromeCopy').onclick = async () => { try { await navigator.clipboard.writeText(JSON.stringify(source()?.steps || [], null, 2)); toast('Шаги скопированы'); } catch { toast('Не удалось скопировать', 'err'); } };
  $('chromeClear').onclick = () => { recorded = []; draftActive = false; $('chromeRecordedList').replaceChildren(); showScenario(); runState('Запись очищена'); };
  panel.querySelector('.record-delete-scenario').onclick = async () => {
    const choice = $('startScenario').value, current = source();
    if (!current?.steps?.length) { toast('Сценарий не выбран', 'err'); return; }
    if(draftActive){if(!confirm('Удалить текущую запись?')) return;recorded=[];draftActive=false;showScenario();toast('Запись удалена');return;}
    await deleteScenarioChoice(choice,current);
  };
  $('chromeUnselect').onclick = () => { if (selectedStep !== null) selectStep(selectedStep); panel.querySelector('.recorder-more').open = false; };
  $('chromeMacroPick').addEventListener('change', event => {
    if (!event.target.value) return;
    draftActive = false; recorded = []; $('chromeRecordedList').replaceChildren();
    $('startScenario').value = event.target.value;
    event.target.value = '';
    applyScenarioSettings();
    showScenario();
  });
  $('startScenario').addEventListener('change', () => { draftActive = false; recorded = []; $('chromeRecordedList').replaceChildren(); showScenario(); });
  $('launchMethod').addEventListener('change', setMode);
  document.querySelectorAll('.method-switch button').forEach(button => button.addEventListener('click', () => {
    $('launchMethod').value = button.dataset.method;
    $('launchMethod').dispatchEvent(new Event('change', {bubbles: true}));
  }));
  const requested = new URLSearchParams(location.search).get('method');
  $('launchMethod').value = requested === 'chrome' ? 'chrome' : localStorage.getItem('katya_launch_method') || 'playwright';
  setMode(); showScenario(); fillMacroPick($('chromeMacroPick'));
  setInterval(() => { if ($('launchMethod').value === 'chrome' && !playing) refreshStatus(); }, 3000);
  setInterval(refreshMedia, 3000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') shot(true); else clearTimeout(shotTimer); });
  window.chromePanel = {start, stop, refresh: refreshStatus, get playing() { return playing; }};
})();
