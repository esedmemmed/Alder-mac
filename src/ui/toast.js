/* A short note at the bottom of the screen (Alder's Toast / caption). One at a time; a new one replaces the old. */
import { h } from '../lib/dom.js';

export function createToaster(host, { setTimeout: st = (f, ms) => setTimeout(f, ms), clearTimeout: ct = (id) => clearTimeout(id) } = {}) {
  let current = null;
  let timer = null;
  let hideTimer = null;

  function remove() {
    if (current && current.parentNode) current.parentNode.removeChild(current);
    current = null;
  }

  return function toast(message, ms = 3000) {
    ct(timer); ct(hideTimer);
    remove();
    current = h('div', { class: 'toast', role: 'status' }, message);
    host.appendChild(current);
    void current.offsetWidth;            // so the fade-in starts from opacity 0
    current.classList.add('on');
    const mine = current;
    timer = st(() => {
      mine.classList.remove('on');
      hideTimer = st(() => { if (current === mine) remove(); }, 260);
    }, ms);
    return mine;
  };
}
