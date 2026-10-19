const $ = id => document.getElementById(id);
const send = (command, payload) => new Promise(resolve => chrome.runtime.sendMessage({kind: 'popup', command, payload}, resolve));
async function refresh() {
  const r = await send('status');
  $('state').textContent = r.tab ? `Подключена: ${r.tab.title || r.tab.url}` : 'Вкладка не подключена';
}
$('attach').onclick = async () => {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  const r = await send('attach', {tabId: tab.id});
  $('state').textContent = r.ok ? `Подключена: ${r.tab.title || r.tab.url}` : r.error;
};
$('detach').onclick = async () => { await send('detach'); await refresh(); };
refresh();
