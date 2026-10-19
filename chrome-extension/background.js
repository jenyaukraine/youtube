const PANEL_ORIGINS = new Set(['https://katya-dev.duckdns.org', 'http://127.0.0.1:8010', 'http://localhost:8010']);
const MAX_EVENTS = 300;
const debugged = new Set();
const viewports = new Map();

async function cdp(tabId, method, params = {}) {
  return chrome.debugger.sendCommand({tabId}, method, params);
}
async function ensureDebugger(tabId) {
  if (debugged.has(tabId)) return;
  try {
    await cdp(tabId, 'Page.enable');
  } catch {
    await chrome.debugger.attach({tabId}, '1.3');
    await cdp(tabId, 'Page.enable');
  }
  debugged.add(tabId);
}
async function releaseDebugger(tabId) {
  if (!Number.isInteger(tabId)) return;
  debugged.delete(tabId);
  viewports.delete(tabId);
  try { await chrome.debugger.detach({tabId}); } catch {}
}
chrome.debugger.onDetach.addListener(source => {
  if (Number.isInteger(source.tabId)) { debugged.delete(source.tabId); viewports.delete(source.tabId); }
});
async function viewport(tabId) {
  const result = await cdp(tabId, 'Runtime.evaluate', {expression: '({width:innerWidth,height:innerHeight})', returnByValue: true});
  const value = result?.result?.value || {};
  const size = {width: Math.max(1, Number(value.width) || 1280), height: Math.max(1, Number(value.height) || 720)};
  viewports.set(tabId, size);
  return size;
}
async function sendInput(tabId, payload) {
  await ensureDebugger(tabId);
  const type = payload.type;
  if (type === 'text') {
    await cdp(tabId, 'Input.insertText', {text: String(payload.text || '').slice(0, 2000)});
    return {ok: true};
  }
  if (type === 'key') {
    const key = String(payload.key || '');
    const code = String(payload.code || '');
    const modifiers = Number(payload.modifiers) || 0;
    const virtual = key.length === 1 ? key.toUpperCase().charCodeAt(0) : ({Enter:13,Tab:9,Backspace:8,Delete:46,Escape:27,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,Home:36,End:35,PageUp:33,PageDown:34,Space:32})[key] || 0;
    const params = {key, code, modifiers, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual};
    await cdp(tabId, 'Input.dispatchKeyEvent', {...params, type: 'rawKeyDown'});
    await cdp(tabId, 'Input.dispatchKeyEvent', {...params, type: 'keyUp'});
    return {ok: true};
  }
  if (!['move', 'down', 'up', 'wheel'].includes(type)) throw new Error('Неизвестное действие мыши');
  const size = viewports.get(tabId) || await viewport(tabId);
  const x = Math.max(0, Math.min(size.width - 1, (Number(payload.x) || 0) * size.width));
  const y = Math.max(0, Math.min(size.height - 1, (Number(payload.y) || 0) * size.height));
  const eventType = {move: 'mouseMoved', down: 'mousePressed', up: 'mouseReleased', wheel: 'mouseWheel'}[type];
  await cdp(tabId, 'Input.dispatchMouseEvent', {
    type: eventType, x, y, button: type === 'down' || type === 'up' ? 'left' : 'none',
    buttons: type === 'down' || (type === 'move' && payload.dragging) ? 1 : 0,
    clickCount: type === 'down' || type === 'up' ? (Number(payload.clickCount) || 1) : 0,
    ...(type === 'wheel' ? {deltaX: Number(payload.deltaX) || 0, deltaY: Number(payload.deltaY) || 0} : {})
  });
  return {ok: true};
}

async function state() {
  return chrome.storage.session.get({targetId: null, recording: false, events: []});
}
async function targetTab() {
  const {targetId} = await state();
  if (!Number.isInteger(targetId)) throw new Error('Сначала подключи вкладку через значок расширения или открой её из панели.');
  try { return await chrome.tabs.get(targetId); }
  catch { await chrome.storage.session.set({targetId: null, recording: false}); throw new Error('Подключённая вкладка закрыта.'); }
}
function allowedTab(url) {
  try { const u = new URL(url); return ['http:', 'https:'].includes(u.protocol) && u.hostname !== 'accounts.google.com'; }
  catch { return false; }
}
async function attach(tabId, expectedUrl = '') {
  const tab = await chrome.tabs.get(tabId);
  if (![tab.url, tab.pendingUrl, expectedUrl].some(allowedTab)) throw new Error('Эту страницу нельзя подключить. Войди в Google вручную и затем открой YouTube.');
  const previous = (await state()).targetId;
  if (previous !== tab.id) await releaseDebugger(previous);
  await chrome.storage.session.set({targetId: tab.id, recording: false, events: []});
  return {ok: true, tab: {id: tab.id, title: tab.title, url: tab.url}};
}
async function waitForTab(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Страница загружается слишком долго')), 20000);
    let done = false;
    function finish(error) { if (done) return; done = true; clearTimeout(timer); chrome.tabs.onUpdated.removeListener(updated); error ? reject(error) : resolve(); }
    function updated(id, change) { if (id === tabId && change.status === 'complete') finish(); }
    chrome.tabs.onUpdated.addListener(updated);
    chrome.tabs.get(tabId).then(tab => { if (tab.status === 'complete') finish(); }, finish);
  });
}

function domAction(step) {
  function find() {
    const query = String(step.query || '');
    const nth = Math.max(0, Number(step.nth) || 0);
    if (query && step.kind === 'text') return [...document.querySelectorAll('button,a,label,summary,input,[role],p,span')].filter(el => (el.textContent || el.value || '').trim().includes(query))[nth] || null;
    if (query && (step.kind === 'role' || String(step.kind).startsWith('role:'))) {
      const role = String(step.kind).startsWith('role:') ? String(step.kind).slice(5) : step.role || 'button';
      const native = role === 'link' ? ',a' : role === 'button' ? ',button' : role === 'textbox' ? ',input,textarea' : '';
      return [...document.querySelectorAll(`[role="${CSS.escape(role)}"]${native}`)].filter(el => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().includes(query))[nth] || null;
    }
    if (query && step.kind === 'label') {
      const label = [...document.querySelectorAll('label')].find(el => el.textContent?.trim().includes(query));
      return label?.control || label?.querySelector('input,textarea,select') || null;
    }
    if (query && step.kind === 'placeholder') return [...document.querySelectorAll('[placeholder]')].filter(el => el.getAttribute('placeholder').includes(query))[nth] || null;
    if (query && step.kind === 'xpath') { try { return document.evaluate(query, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotItem(nth); } catch { return null; } }
    if (query) { try { return document.querySelectorAll(query)[nth] || null; } catch { return null; } }
    if (['press', 'type'].includes(step.action) && document.activeElement instanceof HTMLElement) return document.activeElement;
    return document.elementFromPoint((Number(step.x) || 0) * innerWidth, (Number(step.y) || 0) * innerHeight);
  }
  const action = step.action;
  if (action === 'scroll') { const target = step.query ? find() : null; (target || window).scrollBy({top: Number(step.value) || 0, behavior: 'instant'}); return {ok: true}; }
  if (action === 'reload') { location.reload(); return {ok: true}; }
  if (action === 'wait_for' || action === 'wait_gone' || action === 'wait_click') {
    const end = Date.now() + Math.min(30000, Math.max(1000, Number(step.timeout_ms) || 7000));
    return new Promise(resolve => {
      const tick = () => {
        const el = find(), ready = action === 'wait_gone' ? !el : !!el;
        if (ready) { if (action === 'wait_click') el.click(); resolve({ok: true}); }
        else if (Date.now() >= end) resolve({ok: false, error: 'Элемент не появился вовремя'});
        else setTimeout(tick, 150);
      };
      tick();
    });
  }
  const el = find();
  if (!el) return {ok: false, error: 'Элемент не найден'};
  if (action === 'locate') {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return {ok: false, error: 'Элемент не виден'};
    return {ok: true, x: (rect.left + rect.width / 2) / innerWidth, y: (rect.top + rect.height / 2) / innerHeight};
  }
  if (action === 'point' || action === 'click') { el.click(); return {ok: true}; }
  if (action === 'dblclick') { el.dispatchEvent(new MouseEvent('dblclick', {bubbles: true, cancelable: true})); return {ok: true}; }
  if (action === 'hover') { el.dispatchEvent(new MouseEvent('mouseover', {bubbles: true})); return {ok: true}; }
  if (action === 'text') return {ok: true, value: el.textContent?.trim() || ''};
  if (action === 'select') { el.value = String(step.value || ''); el.dispatchEvent(new Event('change', {bubbles: true})); return {ok: true}; }
  if (action === 'fill' || action === 'type') {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return {ok: false, error: 'Это не поле ввода'};
    if (el instanceof HTMLInputElement && ['password', 'file', 'hidden'].includes(el.type)) return {ok: false, error: 'Ввод пароля и файлов выполняется вручную'};
    el.focus();
    const value = action === 'type' && !step.replace ? el.value + String(step.value || '') : String(step.value || '');
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', {bubbles: true}));
    el.dispatchEvent(new Event('change', {bubbles: true}));
    return {ok: true};
  }
  if (action === 'press') {
    const key = String(step.value || '');
    if (key === 'Enter' && el.form) { el.form.requestSubmit(); return {ok: true}; }
    el.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true}));
    el.dispatchEvent(new KeyboardEvent('keyup', {key, bubbles: true}));
    return {ok: true};
  }
  return {ok: false, error: `Действие ${action} пока не поддерживается расширением`};
}

async function handle(command, payload = {}) {
  if (command === 'status') {
    const s = await state();
    let tab = null;
    if (s.targetId) { try { const t = await chrome.tabs.get(s.targetId); tab = {id: t.id, title: t.title, url: t.url}; } catch {} }
    return {ok: true, version: chrome.runtime.getManifest().version, tab, recording: s.recording, events: s.events.length};
  }
  if (command === 'tabs') {
    const tabs = await chrome.tabs.query({});
    return {ok: true, tabs: tabs.filter(t => allowedTab(t.url || t.pendingUrl) && !PANEL_ORIGINS.has(new URL(t.url || t.pendingUrl).origin)).slice(0, 60).map(t => ({id: t.id, title: t.title, url: t.url || t.pendingUrl}))};
  }
  if (command === 'attach') return attach(Number(payload.tabId));
  if (command === 'promote') {
    const tab = await targetTab();
    await releaseDebugger(tab.id);
    await chrome.windows.create({tabId: tab.id, focused: false, type: 'normal', width: 1280, height: 820});
    return {ok: true};
  }
  if (command === 'open') {
    if (!allowedTab(payload.url)) throw new Error('Нужен обычный http(s) адрес. Вход Google выполняется вручную.');
    const win = await chrome.windows.create({url: payload.url, focused: false, type: 'normal', width: 1280, height: 820});
    const tab = win.tabs?.[0];
    if (!tab) throw new Error('Chrome не открыл вкладку');
    return attach(tab.id, payload.url);
  }
  if (command === 'media') {
    const tab = await targetTab();
    if (!allowedTab(tab.url)) return {ok: true, media: null};
    const response = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: () => {
      const video = document.querySelector('video');
      return {visibility: document.visibilityState, video: video ? {paused: video.paused, readyState: video.readyState, networkState: video.networkState, currentTime: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : 0, error: video.error?.message || ''} : null};
    }});
    return {ok: true, media: response[0]?.result || null};
  }
  if (command === 'media-action') {
    const tab = await targetTab();
    if (!allowedTab(tab.url)) throw new Error('Видео недоступно на этой странице.');
    const response = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: async action => {
      const video = document.querySelector('video');
      if (!video) return {ok: false, error: 'Видео на странице не найдено'};
      if (action.type === 'seek') {
        const desired = Math.max(0, Math.min(Number.isFinite(video.duration) ? video.duration : Infinity, Number(action.time) || 0));
        video.currentTime = desired;
        if (Math.abs(video.currentTime - desired) > 0.5) {
          const landed = await new Promise(resolve => {
            const timer = setTimeout(() => { video.removeEventListener('seeked', done); resolve(false); }, 3000);
            function done() { clearTimeout(timer); resolve(true); }
            video.addEventListener('seeked', done, {once: true});
          });
          if (!landed || Math.abs(video.currentTime - desired) > 0.5) return {ok: false, error: 'Плеер не смог перейти к выбранному моменту'};
        }
      }
      else if (action.type === 'pause') video.pause();
      else if (action.type === 'play') { try { await video.play(); } catch (error) { return {ok: false, error: error.message || 'Chrome не разрешил воспроизведение'}; } }
      else return {ok: false, error: 'Неизвестное действие с видео'};
      return {ok: true, currentTime: video.currentTime, paused: video.paused};
    }, args: [payload]} );
    return response[0]?.result || {ok: false, error: 'Видео не ответило'};
  }
  if (command === 'detach') { const s = await state(); await releaseDebugger(s.targetId); await chrome.storage.session.set({targetId: null, recording: false}); return {ok: true}; }
  if (command === 'record') {
    await targetTab();
    await chrome.storage.session.set({recording: Boolean(payload.enabled), ...(payload.enabled ? {events: []} : {})});
    return {ok: true, recording: Boolean(payload.enabled)};
  }
  if (command === 'events') { const s = await state(); return {ok: true, events: s.events}; }
  if (command === 'input') {
    const tab = await targetTab();
    if (!allowedTab(tab.url)) throw new Error('На странице входа Google действия выполняются вручную.');
    return sendInput(tab.id, payload);
  }
  if (command === 'execute') {
    const tab = await targetTab();
    if (!allowedTab(tab.url)) throw new Error('На странице входа Google действия выполняются вручную.');
    const step = payload.step || {};
    if (step.action === 'navigate') {
      if (!allowedTab(step.value)) throw new Error('Переход на этот адрес недоступен.');
      await chrome.tabs.update(tab.id, {url: step.value});
      await waitForTab(tab.id);
      return {ok: true};
    }
    if (step.action === 'wait') {
      await new Promise(resolve => setTimeout(resolve, Math.min(60000, Math.max(0, Number(step.value) || 0)))); return {ok: true};
    }
    if (step.action === 'back') { await chrome.tabs.goBack(tab.id); return {ok: true}; }
    if (step.action === 'wait_url') {
      const end = Date.now() + Math.min(30000, Math.max(1000, Number(step.timeout_ms) || 7000));
      while (Date.now() < end) { const current = await chrome.tabs.get(tab.id); if ((current.url || '').includes(String(step.value || ''))) return {ok: true}; await new Promise(resolve => setTimeout(resolve, 200)); }
      return {ok: false, error: 'Адрес не появился вовремя'};
    }
    if (['point', 'click', 'dblclick', 'hover'].includes(step.action)) {
      let point = null;
      if (step.query) {
        const results = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: domAction, args: [{...step, action: 'locate'}]});
        if (results[0]?.result?.ok) point = results[0].result;
      }
      if (!point && ['point', 'hover'].includes(step.action) && Number.isFinite(Number(step.x)) && Number.isFinite(Number(step.y))) point = step;
      if (!point) return {ok: false, error: 'Элемент не найден'};
      await sendInput(tab.id, {type: 'move', x: point.x, y: point.y});
      if (step.action === 'hover') return {ok: true};
      await sendInput(tab.id, {type: 'down', x: point.x, y: point.y});
      await sendInput(tab.id, {type: 'up', x: point.x, y: point.y});
      if (step.action === 'dblclick') { await sendInput(tab.id, {type: 'down', x: point.x, y: point.y, clickCount: 2}); await sendInput(tab.id, {type: 'up', x: point.x, y: point.y, clickCount: 2}); }
      return {ok: true};
    }
    if (step.action === 'move') return sendInput(tab.id, {type: 'move', x: step.x, y: step.y});
    if (step.action === 'mouse_drag' && Number.isFinite(Number(step.x)) && Number.isFinite(Number(step.y))) {
      await sendInput(tab.id, {type: 'move', x: step.x, y: step.y});
      await sendInput(tab.id, {type: 'down', x: step.x, y: step.y});
      const slices = 12;
      for (let i = 1; i <= slices; i++) await sendInput(tab.id, {type: 'move', dragging: true, x: Number(step.x) + (Number(step.end_x) - Number(step.x)) * i / slices, y: Number(step.y) + (Number(step.end_y) - Number(step.y)) * i / slices});
      await sendInput(tab.id, {type: 'up', x: step.end_x, y: step.end_y});
      return {ok: true};
    }
    if (step.action === 'press') return sendInput(tab.id, {type: 'key', key: String(step.value || ''), code: String(step.value || '')});
    const results = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: domAction, args: [step]});
    return results[0]?.result || {ok: false, error: 'Нет ответа от вкладки'};
  }
  if (command === 'screenshot') {
    const tab = await targetTab();
    if (!allowedTab(tab.url)) throw new Error('На странице входа Google действия выполняются вручную.');
    await ensureDebugger(tab.id);
    const size = await viewport(tab.id);
    const result = await cdp(tab.id, 'Page.captureScreenshot', {format: 'jpeg', quality: 65, fromSurface: true, captureBeyondViewport: false});
    return {ok: true, image: `data:image/jpeg;base64,${result.data}`, width: size.width, height: size.height};
  }
  throw new Error('Неизвестная команда');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.kind === 'record-event') {
    (async () => {
      const s = await state();
      if (!s.recording || sender.tab?.id !== s.targetId || !allowedTab(sender.tab?.url)) return;
      const events = [...s.events, {step: message.step, at: message.at}].slice(-MAX_EVENTS);
      await chrome.storage.session.set({events});
    })();
    return;
  }
  if (message?.kind === 'dashboard') {
    let origin = '';
    try { origin = new URL(sender.tab?.url || '').origin; } catch {}
    if (!PANEL_ORIGINS.has(origin)) { sendResponse({ok: false, error: 'Недоступный источник'}); return; }
    handle(message.command, message.payload).then(sendResponse, error => sendResponse({ok: false, error: error.message}));
    return true;
  }
  if (message?.kind === 'popup') {
    handle(message.command, message.payload).then(sendResponse, error => sendResponse({ok: false, error: error.message}));
    return true;
  }
});
