// The dashboard talks to this isolated content script; no extension ID is needed.
const KATYA_ORIGINS = new Set(['https://katya-dev.duckdns.org', 'http://127.0.0.1:8010', 'http://localhost:8010']);
if (KATYA_ORIGINS.has(location.origin)) {
  window.postMessage({source: 'katya-extension', kind: 'ready'}, location.origin);
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'katya-dashboard' || !event.data.id) return;
    chrome.runtime.sendMessage({kind: 'dashboard', command: event.data.command, payload: event.data.payload}, reply => {
      window.postMessage({source: 'katya-extension', id: event.data.id,
        reply: reply || {ok: false, error: chrome.runtime.lastError?.message || 'Нет ответа от расширения'}}, location.origin);
    });
  });
}
