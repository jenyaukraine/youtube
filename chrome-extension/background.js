const PANEL_ORIGINS = new Set(['https://katya-dev.duckdns.org', 'http://127.0.0.1:8010', 'http://localhost:8010']);
const MAX_EVENTS = 300;

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
    if (query && step.kind === 'role') return [...document.querySelectorAll(`[role="${CSS.escape(step.role || 'button')}"]${step.role === 'link' ? ',a' : ',button'}`)].filter(el => (el.getAttribute('aria-label') || el.textContent || '').trim().includes(query))[nth] || null;
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
    return {ok: true, tab, recording: s.recording, events: s.events.length};
  }
  if (command === 'attach') return attach(Number(payload.tabId));
  if (command === 'open') {
    if (!allowedTab(payload.url)) throw new Error('Нужен обычный http(s) адрес. Вход Google выполняется вручную.');
    const tab = await chrome.tabs.create({url: payload.url, active: true});
    return attach(tab.id, payload.url);
  }
  if (command === 'detach') { await chrome.storage.session.set({targetId: null, recording: false}); return {ok: true}; }
  if (command === 'record') {
    await targetTab();
    await chrome.storage.session.set({recording: Boolean(payload.enabled), ...(payload.enabled ? {events: []} : {})});
    return {ok: true, recording: Boolean(payload.enabled)};
  }
  if (command === 'events') { const s = await state(); return {ok: true, events: s.events}; }
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
    const results = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: domAction, args: [step]});
    return results[0]?.result || {ok: false, error: 'Нет ответа от вкладки'};
  }
  if (command === 'screenshot') {
    const tab = await targetTab();
    await chrome.tabs.update(tab.id, {active: true});
    const image = await chrome.tabs.captureVisibleTab(tab.windowId, {format: 'jpeg', quality: 70});
    return {ok: true, image};
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
