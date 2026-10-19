// The dashboard talks to this isolated content script; no extension ID is needed.
const KATYA_PANEL = location.origin === 'https://katya-dev.duckdns.org' ||
  (location.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(location.hostname));
if (KATYA_PANEL) {
  window.postMessage({source: 'katya-extension', kind: 'ready'}, location.origin);
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'katya-dashboard' || !event.data.id) return;
    chrome.runtime.sendMessage({kind: 'dashboard', command: event.data.command, payload: event.data.payload}, reply => {
      window.postMessage({source: 'katya-extension', id: event.data.id,
        reply: reply || {ok: false, error: chrome.runtime.lastError?.message || 'Нет ответа от расширения'}}, location.origin);
    });
  });
}
