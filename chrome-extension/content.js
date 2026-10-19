// Record only user actions in the attached tab. Passwords and private fields stay out of recordings.
const scrollState = new WeakMap();
function selectorFor(node) {
  if (!(node instanceof Element)) return '';
  if (node.id) return '#' + CSS.escape(node.id);
  const testid = node.getAttribute('data-testid');
  if (testid) return '[data-testid="' + CSS.escape(testid) + '"]';
  if (node.getAttribute('name')) return node.tagName.toLowerCase() + '[name="' + CSS.escape(node.getAttribute('name')) + '"]';
  const parts = [];
  for (let el = node, depth = 0; el && el !== document.body && depth < 5; el = el.parentElement, depth++) {
    const tag = el.tagName.toLowerCase();
    const peers = [...el.parentElement.children].filter(child => child.tagName === el.tagName);
    parts.unshift(tag + (peers.length > 1 ? `:nth-of-type(${peers.indexOf(el) + 1})` : ''));
  }
  return parts.join(' > ');
}
function safeField(node) {
  if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement)) return false;
  if (node instanceof HTMLInputElement && ['password', 'hidden', 'file', 'credit-card'].includes(node.type)) return false;
  if (node.closest('[autocomplete="cc-number"],[autocomplete="current-password"],[autocomplete="new-password"]')) return false;
  return true;
}
function record(step) {
  if (location.hostname === 'accounts.google.com') return;
  chrome.runtime.sendMessage({kind: 'record-event', step, at: Date.now()}, () => void chrome.runtime.lastError);
}
document.addEventListener('click', event => {
  if (!event.isTrusted || !(event.target instanceof Element)) return;
  const target = event.target.closest('button,a,input,[role="button"],label,summary') || event.target;
  record({action: 'point', kind: 'css', query: selectorFor(target), x: event.clientX / innerWidth, y: event.clientY / innerHeight});
}, true);
document.addEventListener('change', event => {
  if (!event.isTrusted || !safeField(event.target)) return;
  const field = event.target;
  record({action: 'fill', kind: 'css', query: selectorFor(field), value: String(field.value).slice(0, 2000)});
}, true);
document.addEventListener('scroll', event => {
  const element = event.target instanceof Element ? event.target : document.scrollingElement;
  if (!element) return;
  const old = scrollState.get(element) || {top: 0, timer: null};
  clearTimeout(old.timer);
  const previous = old.top;
  old.timer = setTimeout(() => {
    const delta = element.scrollTop - previous;
    if (Math.abs(delta) >= 10) record({action: 'scroll', query: element === document.scrollingElement ? '' : selectorFor(element), value: String(Math.round(delta))});
    scrollState.set(element, {top: element.scrollTop, timer: null});
  }, 250);
  scrollState.set(element, old);
}, true);
