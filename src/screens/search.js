/*
 * Search (port of SearchActivity.kt, docs/search.jpg): House Lights search, an on-screen letter grid at the left (the remote moves
 * over it; OK types), the focused title's logo, facts and story in the middle, and poster rows (Movies, Shows) under it. The
 * field is a real <input> too: Up from the first key reaches it and OK opens the TV's own keyboard (Tizen IME); a USB keyboard
 * types straight in. Search runs 500 ms after typing stops (TYPING_PAUSE) across the account's add-ons, each add-on within 5 s
 * (Addon.search), the screen settling after SEARCH_WAIT; results keep the add-ons' order, better title matches first.
 * With nothing typed it shows Popular. Recent searches are kept per profile (6, newest first; hold OK removes one).
 *
 *   router.push('search', {})
 */
import { h, clear } from '../lib/dom.js';
import { logoFor } from '../lib/images.js';
import { runtime } from '../core/addon.js';
import { stableSort } from '../core/util.js';
import { KEYS } from '../core/keys.js';
import { createCard } from '../ui/card.js';
import { chip } from '../ui/chip.js';
import { iconSvg, iconEl } from '../ui/icons.js';
import { openPanel } from '../ui/panel.js';
import { clock, artLayer, failedCard, ring, imdbTag, avatar } from '../ui/screens-b/kit.js';
import {
  rankSearchTitles, searchAnswersInAddonOrder, isAddonMessage, parseRecent, rememberRecent, synopsisAtSentence, searchFacts,
} from '../ui/screens-b/helpers.js';

const PER_TYPE = 12;
const TYPING_PAUSE = 500; // ms
const SEARCH_WAIT = 6000; // ms: the screen settles with what has answered
const STEP = 204; // px: a poster and its gap
const ROW_PAD = 12; // px at the row's start, room for a focused poster to grow
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const SYMBOLS = '1234567890@#$%&*()!?.,:/+';

export function createSearchScreen() {
  let ctx = null;
  let session = null;
  let root = null;
  let art = null;
  let clockEl = null;
  let dead = false;
  let input = null;
  let measure = null;
  let cursor = null;
  let field = null;
  let clearBtn = null;
  let countEl = null;
  let recentBox = null;
  let resultsEl = null;
  let hero = null;
  let request = 0;
  let typedTimer = null;
  let settleTimer = null;
  let numeric = false;
  let modeKey = null;
  let lastKey = null;
  let focusedMeta = null;
  let sections = []; // { el, track, cards: [el], metas, caption }
  let keyEls = [];
  let rightEdge = new Set();
  let firstKey = null;
  let navSearch = null;
  let sectionTop = 0;
  let onWindowKey = null;

  const profile = () => session.profile();
  const recentKey = () => KEYS.recentSearches(profile() ? profile().id : '');

  // ---------- the keyboard ----------

  function type(value) {
    const at = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
    input.value = input.value.slice(0, at) + value + input.value.slice(at);
    try { input.setSelectionRange(at + value.length, at + value.length); } catch (e) { /* not selectable */ }
    changed();
  }

  function erase() {
    const at = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
    if (at > 0) {
      input.value = input.value.slice(0, at - 1) + input.value.slice(at);
      try { input.setSelectionRange(at - 1, at - 1); } catch (e) { /* not selectable */ }
      changed();
    }
  }

  function key(label, row, span, edge, click) {
    const el = h('div', { class: 'sr-key' + (label.length > 1 ? ' word' : ''), 'data-focus': '', tabindex: '-1', role: 'button', style: { flex: String(span) + ' 1 0' } }, label);
    el.addEventListener('click', () => {
      if (lastKey && lastKey !== el) lastKey.classList.remove('last');
      lastKey = el;
      el.classList.add('last');
      click();
    });
    row.appendChild(el);
    if (!firstKey) firstKey = el;
    if (edge) rightEdge.add(el);
    keyEls.push(el);
    return el;
  }

  function buildKeyboard() {
    const kb = h('div', { class: 'sr-kb' });
    const chars = [];
    const rowEl = () => { const r = h('div', { class: 'sr-kbrow' }); kb.appendChild(r); return r; };
    for (let r = 0; r < 4; r++) {
      const row = rowEl();
      for (let c = 0; c < 6; c++) {
        const index = r * 6 + c;
        chars[index] = key(LETTERS[index], row, 1, c === 5, () => type(chars[index].textContent));
      }
    }
    const fifth = rowEl();
    for (let index = 24; index <= 25; index++) chars[index] = key(LETTERS[index], fifth, 1, false, () => type(chars[index].textContent));
    modeKey = key('123', fifth, 1, false, () => {
      numeric = !numeric;
      chars.forEach((el, index) => { el.textContent = numeric ? (SYMBOLS.charAt(index) || '·') : LETTERS[index]; });
      modeKey.textContent = numeric ? 'ABC' : '123';
    });
    key('−', fifth, 1, false, () => type('-'));
    key('⌫', fifth, 2, true, erase);
    const last = rowEl();
    key('SPACE', last, 6, true, () => type(' ')); // no voice search on a Tizen TV: the space bar takes the whole row
    return kb;
  }

  // ---------- the field ----------

  function placeCursor() {
    const focused = document.activeElement === input;
    cursor.style.display = focused ? 'none' : '';
    measure.textContent = input.value;
    cursor.style.transform = 'translate3d(' + measure.offsetWidth + 'px,0,0)';
  }

  function changed() {
    placeCursor();
    clearBtn.hidden = !input.value;
    ++request;
    clearTimeout(typedTimer);
    clearTimeout(settleTimer);
    typedTimer = setTimeout(() => search(false), TYPING_PAUSE);
  }

  // ---------- recent searches ----------

  const recent = () => parseRecent(session.store.get(recentKey(), ''));
  const saveRecent = (list) => session.store.set(recentKey(), list.join('\n'));

  function showRecent() {
    clear(recentBox);
    const values = recent();
    if (!values.length) return;
    recentBox.appendChild(h('div', { class: 'caps t-3 sr-recent-h' }, 'Recent'));
    for (let i = 0; i < values.length; i += 2) {
      const line = h('div', { class: 'sr-recent-line' });
      values.slice(i, i + 2).forEach((query) => {
        const c = chip(query, { selected: false });
        c.el.classList.add('sr-recent');
        c.el.setAttribute('aria-label', query + '. Hold OK to remove from recent searches');
        c.el.addEventListener('click', () => { input.value = query; changed(); clearTimeout(typedTimer); search(true); });
        c.el.addEventListener('alder:hold', () => openPanel(ctx, {
          title: 'Remove recent search?', items: ['Remove ' + query, 'Cancel'], focus: 0,
          onPick: (n) => { if (n === 0) { saveRecent(recent().filter((s) => s !== query)); showRecent(); } },
        }));
        line.appendChild(c.el);
      });
      recentBox.appendChild(line);
    }
    recentBox.appendChild(h('div', { class: 't-small t-3 sr-recent-hint' }, 'Hold OK to remove'));
  }

  // ---------- results ----------

  function setStatus(node) { clear(resultsEl); sections = []; resultsEl.style.transform = ''; resultsEl.appendChild(node); }

  function search(moveFocus) {
    const query = input.value.trim();
    const token = ++request;
    clearTimeout(typedTimer);
    clearTimeout(settleTimer);
    sections = [];
    focusedMeta = null;
    hero.style.visibility = 'hidden';
    sectionTop = 0;
    setStatus(h('div', { class: 'sr-wait' }, ring()));
    countEl.textContent = '';
    if (!query) { popular(token); return; }
    session.addons().then((addons) => {
      if (dead || token !== request) return;
      const answers = addons.map(() => null);
      let completed = 0;
      let failedCount = 0;
      let finished = false;
      const update = (final) => {
        if (dead || token !== request || finished) return;
        const seen = new Set();
        const found = searchAnswersInAddonOrder(answers)
          .filter((m) => (m.type === 'movie' || m.type === 'series') && !isAddonMessage(m.name))
          .filter((m) => { const k = m.type + '|' + m.id; if (seen.has(k)) return false; seen.add(k); return true; });
        const ranked = rankSearchTitles(found, query, (m) => m.name);
        const groups = [['Movies', ranked.filter((m) => m.type === 'movie').slice(0, PER_TYPE)], ['Shows', ranked.filter((m) => m.type === 'series').slice(0, PER_TYPE)]]
          .filter((g) => g[1].length > 0);
        const done = final || completed === addons.length;
        if (groups.length) render(groups, query, moveFocus && done);
        else if (done) {
          setStatus(failedCount === completed && (completed > 0 || final)
            ? failedCard('Search is unavailable right now.', () => search(false))
            : h('div', { class: 't-body t-2 on-art sr-none' }, 'No matches · Try a shorter title'));
          countEl.textContent = '';
        }
      };
      if (!addons.length) { update(true); return; }
      settleTimer = setTimeout(() => { if (token === request) { update(true); finished = true; } }, SEARCH_WAIT);
      addons.forEach((addon, index) => {
        addon.search(query).then(
          (metas) => { if (dead || token !== request || finished) return; completed++; answers[index] = metas; update(false); if (completed === addons.length) finished = true; },
          () => { if (dead || token !== request || finished) return; completed++; failedCount++; update(false); if (completed === addons.length) finished = true; },
        );
      });
    }, () => {
      if (dead || token !== request) return;
      setStatus(failedCard('Search is unavailable right now.', () => search(false)));
    });
  }

  /** Nothing typed: Popular or trending first, then any other catalog; one that fails or comes back empty gives way to the next. */
  async function popular(token) {
    let titles = [];
    try {
      const addons = await session.addons();
      const catalogs = [];
      addons.forEach((a) => a.catalogs.forEach((c) => { if (c.type === 'movie' || c.type === 'series') catalogs.push(c); }));
      const liked = (c) => (/popular|trending/i.test(c.name) ? 0 : 1);
      const ordered = stableSort(catalogs, (a, b) => liked(a) - liked(b)).slice(0, 4);
      for (const c of ordered) {
        let list = [];
        try { list = c.addon.savedCatalog(c) || []; if (!list.length) list = await c.addon.catalog(c); } catch (e) { list = []; }
        list = list.filter((m) => !isAddonMessage(m.name)).slice(0, PER_TYPE);
        if (list.length) { titles = list; break; }
      }
    } catch (e) { titles = []; }
    if (dead || token !== request) return;
    if (!titles.length) setStatus(failedCard('Popular titles are unavailable.', () => search(false)));
    else render([['Popular', titles]], '', false);
  }

  function render(groups, query, moveFocus) {
    const active = ctx.engine.current();
    const selected = active && resultsEl.contains(active) ? active.getAttribute('data-key') : null;
    clear(resultsEl);
    sections = [];
    const total = groups.reduce((n, g) => n + g[1].length, 0);
    countEl.textContent = !total || !query ? '' : total === 1 ? '1 title' : total + ' titles'; // not for Popular
    groups.forEach(([label, metas]) => {
      const track = h('div', { class: 'sr-track' });
      const caption = h('div', { class: 'sr-caption', style: { visibility: 'hidden' } });
      const viewport = h('div', { class: 'sr-viewport' }, track);
      const section = { track, cards: [], metas, caption, viewport };
      metas.forEach((meta, index) => {
        const card = createCard({ id: meta.id, name: meta.name, poster: meta.poster || meta.background }, index, { left: ROW_PAD + index * STEP, width: 176, height: 264 }, ctx.images);
        card.classList.add('sr-card');
        card.setAttribute('data-key', meta.type + ':' + meta.id);
        card.addEventListener('focus', () => onCardFocus(section, index));
        card.addEventListener('blur', () => { caption.style.visibility = 'hidden'; });
        card.addEventListener('click', () => open(meta));
        track.appendChild(card);
        section.cards.push(card);
      });
      const el = h('div', { class: 'sr-section' },
        h('div', { class: 'sr-label' }, h('span', { class: 'caps on-art' }, label), h('span', { class: 't-small t-3 on-art sr-labelcount' }, String(metas.length))),
        viewport, caption);
      section.el = el;
      resultsEl.appendChild(el);
      sections.push(section);
    });
    resultsEl.style.transform = '';
    sectionTop = 0;
    show(groups[0][1][0]);
    const again = selected ? resultsEl.querySelector('[data-key="' + selected.replace(/"/g, '') + '"]') : null;
    if (again) ctx.engine.focus(again);
    else if (moveFocus && sections.length) ctx.engine.focus(sections[0].cards[0]);
  }

  function onCardFocus(section, index) {
    // The focused row snaps to the pane's top, as on Home; rows above it draw nothing.
    const at = sections.indexOf(section);
    sectionTop = section.el.offsetTop;
    resultsEl.style.transform = 'translate3d(0,' + (-sectionTop) + 'px,0)';
    sections.forEach((s, i) => { s.el.style.opacity = i < at ? '0' : '1'; });
    // The focused card goes to the row's start; near the end the row stops with the last card at the margin.
    const viewport = section.viewport.clientWidth || 1280;
    const total = ROW_PAD + section.cards.length * STEP - 28 + 96;
    const target = Math.max(0, Math.min(Math.max(0, total - viewport), index * STEP));
    section.track.style.transform = 'translate3d(' + (-target) + 'px,0,0)';
    section.cards.forEach((c, i) => { c.style.opacity = i * STEP < target - 1 ? '0' : ''; });
    const meta = section.metas[index];
    section.caption.textContent = meta.name + (meta.year ? '  ·  ' + meta.year.slice(0, 4) : '');
    section.caption.style.visibility = 'visible';
    section.caption.style.transform = 'translate3d(' + Math.max(0, Math.min(ROW_PAD + index * STEP - target, 1280 - 96 - section.caption.offsetWidth)) + 'px,0,0)';
    show(meta);
  }

  function open(meta) {
    const q = input.value.trim();
    if (q) saveRecent(rememberRecent(recent(), q));
    ctx.router.push('details', { type: meta.type, id: meta.id, name: meta.name, poster: meta.poster, background: meta.background });
  }

  /** The focused title: its art behind the screen, its logo (or name), facts, rating and the first two lines of its story. */
  function show(meta) {
    if (focusedMeta && focusedMeta.type === meta.type && focusedMeta.id === meta.id) return;
    focusedMeta = meta;
    hero.style.visibility = '';
    art.set(meta.background || meta.poster, {});
    const hl = hero.logo, hn = hero.name;
    hn.textContent = meta.name;
    hn.style.display = 'none';
    hl.classList.remove('on');
    ctx.images.load(hl, meta.logo || logoFor(meta.id), { urgent: true, onDone() { if (focusedMeta === meta) { hl.classList.add('on'); hn.style.display = 'none'; } }, onFail() { if (focusedMeta === meta) { hl.classList.remove('on'); hn.style.display = ''; } } });
    hero.facts.textContent = searchFacts(meta, runtime) + (meta.rating ? '  ·' : '');
    hero.tag.style.display = meta.rating ? '' : 'none';
    hero.score.style.display = meta.rating ? '' : 'none';
    hero.score.textContent = meta.rating || '';
    const description = meta.description || '';
    hero.about.textContent = description;
    hero.about.style.display = description.trim() ? '' : 'none';
    // Two lines: a story that runs on is cut at a whole sentence, else at a word with an ellipsis.
    if (description && hero.about.scrollHeight > hero.about.clientHeight + 1) {
      let lo = 0, hi = description.length;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        hero.about.textContent = description.slice(0, mid) + '…';
        if (hero.about.scrollHeight > hero.about.clientHeight + 1) hi = mid; else lo = mid;
      }
      hero.about.textContent = synopsisAtSentence(description, lo);
    }
  }

  // ---------- the screen ----------

  function header() {
    const p = profile();
    const av = avatar(p);
    av.addEventListener('click', () => openPanel(ctx, {
      title: p ? p.name : 'Profile', items: ['Switch profile', 'Settings'], focus: 0,
      onPick: (i) => { if (i === 0) ctx.router.reset('profiles', {}); else ctx.router.push('settings', {}); },
    }));
    navSearch = h('div', { class: 'nav-item on', 'data-focus': '', tabindex: '-1', role: 'button', 'data-nav': 'Search', 'aria-label': 'Search' }, h('span', { class: 'icon', html: iconSvg('search') }));
    const pages = ['Home', 'Shows', 'Movies', 'My List'].map((page) => {
      const el = h('div', { class: 'nav-item', 'data-focus': '', tabindex: '-1', role: 'button', 'data-nav': page }, page);
      el.addEventListener('click', () => ctx.router.reset('home', { page }));
      return el;
    });
    navSearch.addEventListener('click', () => input.focus());
    return h('div', { class: 'topbar' }, av, h('div', { class: 'navpill glass' }, navSearch, pages));
  }

  return {
    mount(el, p, context) {
      ctx = context;
      session = context.session;
      root = el;
      el.classList.add('sr-screen');
      art = artLayer(ctx.images);
      el.appendChild(art.el);
      el.appendChild(h('div', { class: 'sr-shades' }));
      clockEl = clock();
      el.appendChild(header());
      el.appendChild(clockEl.el);

      input = h('input', { class: 'sr-input', type: 'text', 'data-focus': '', tabindex: '-1', placeholder: 'Search', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', maxlength: '80' });
      measure = h('span', { class: 'sr-measure' });
      cursor = h('span', { class: 'sr-cursor' });
      countEl = h('span', { class: 'sr-count t-small t-3' });
      clearBtn = h('div', { class: 'sr-clear', 'data-focus': '', tabindex: '-1', role: 'button', 'aria-label': 'Clear search', hidden: true }, iconEl('close', 32));
      clearBtn.addEventListener('click', () => { input.value = ''; changed(); clearTimeout(typedTimer); search(false); ctx.engine.focus(firstKey); });
      field = h('div', { class: 'sr-field' }, h('span', { class: 'icon sr-fieldicon', html: iconSvg('search') }),
        h('div', { class: 'sr-inputbox' }, input, measure, cursor), countEl, clearBtn);
      el.appendChild(field);
      el.appendChild(buildKeyboard());
      recentBox = h('div', { class: 'sr-recentbox' });
      el.appendChild(recentBox);

      hero = h('div', { class: 'sr-hero', style: { visibility: 'hidden' } });
      hero.logo = h('img', { class: 'sr-herologo', alt: '' });
      hero.name = h('div', { class: 'sr-heroname serif on-art', style: { display: 'none' } });
      hero.facts = h('span', { class: 't-small t-2 on-art' });
      hero.tag = imdbTag();
      hero.score = h('span', { class: 't-small t-2 on-art sr-score' });
      hero.about = h('div', { class: 'sr-about t-body on-art' });
      hero.appendChild(hero.logo);
      hero.appendChild(hero.name);
      hero.appendChild(h('div', { class: 'sr-facts' }, hero.facts, hero.tag, hero.score));
      hero.appendChild(hero.about);
      el.appendChild(hero);
      resultsEl = h('div', { class: 'sr-results-inner' });
      el.appendChild(h('div', { class: 'sr-results' }, resultsEl));

      input.addEventListener('input', changed);
      input.addEventListener('focus', placeCursor);
      input.addEventListener('blur', placeCursor);
      input.addEventListener('change', () => { clearTimeout(typedTimer); search(true); });
      input.addEventListener('keydown', (e) => { if (e.keyCode === 65376) { clearTimeout(typedTimer); search(true); ctx.engine.focus(firstKey); } }); // the TV keyboard's Done
      // A keyboard (USB or the dev harness) types without the grid: letters append, the same as the keys do.
      onWindowKey = (e) => {
        if (document.activeElement === input || e.ctrlKey || e.altKey || e.metaKey || ctx.router.overlayCount() > 0) return;
        if (ctx.router.top() && ctx.router.top().name !== 'search') return;
        if (e.key && e.key.length === 1 && /[A-Za-z0-9 \-.,:'&!?]/.test(e.key) && e.keyCode !== 32) { type(e.key); e.preventDefault(); }
      };
      window.addEventListener('keydown', onWindowKey);

      showRecent();
      placeCursor();
      ctx.engine.focus(firstKey);
      search(false);
    },

    unmount() {
      dead = true;
      clearTimeout(typedTimer);
      clearTimeout(settleTimer);
      if (clockEl) clockEl.stop();
      if (onWindowKey) window.removeEventListener('keydown', onWindowKey);
    },

    resume() { showRecent(); },

    onKey(evt) {
      if (evt.type !== 'press') return false;
      const a = evt.action;
      const code = evt.event ? evt.event.keyCode : 0;
      const focus = ctx.engine.current();
      if (code === 8 && a === 'back') { erase(); return true; } // a keyboard's Backspace: the remote's Back is 10009
      if (code === 32 && a === 'playpause') { type(' '); return true; }
      if (a.length === 1 && a >= '0' && a <= '9' && document.activeElement !== input) { type(a); return true; }
      if (focus === input && a === 'ok') { input.focus(); return false; } // OK on the field opens the TV's keyboard (the IME), it is not a command
      if (a === 'ok' && document.activeElement === input) return false;
      if (!focus) return false;

      const row = sections.findIndex((s) => s.cards.indexOf(focus) >= 0);
      if (row >= 0) {
        const s = sections[row];
        const i = s.cards.indexOf(focus);
        if (a === 'left') { if (i > 0) ctx.engine.focus(s.cards[i - 1]); else ctx.engine.focus(lastKey || firstKey); return true; }
        if (a === 'right') { if (i < s.cards.length - 1) ctx.engine.focus(s.cards[i + 1]); return true; }
        if (a === 'down') { const n = sections[row + 1]; if (n) ctx.engine.focus(n.cards[Math.min(i, n.cards.length - 1)]); return true; }
        if (a === 'up') { const n = sections[row - 1]; if (n) ctx.engine.focus(n.cards[Math.min(i, n.cards.length - 1)]); else ctx.engine.focus(navSearch); return true; }
        return false;
      }
      if (a === 'right' && rightEdge.has(focus)) { if (sections.length) ctx.engine.focus(sections[0].cards[0]); return true; }
      if (a === 'right' && keyEls.indexOf(focus) >= 0) return false;
      if (a === 'left' && keyEls.indexOf(focus) >= 0) {
        // the first key of a row has nothing to its left
        const r = focus.parentNode;
        if (r.firstChild === focus) return true;
      }
      if (a === 'down' && focus === input) { ctx.engine.focus(firstKey); return true; }
      if (a === 'right' && focus === input && !clearBtn.hidden) { ctx.engine.focus(clearBtn); return true; }
      if (a === 'left' && focus === clearBtn) { ctx.engine.focus(input); return true; }
      return false;
    },
  };
}
