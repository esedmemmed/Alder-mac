/*
 * Home (Alder's MainActivity): the profile in use, as a cinema rather than a catalogue. The whole screen is one title's art,
 * sharp where nothing sits on it, with light shading behind the words and the cards (docs/home-dune.png, library.png).
 *
 *  - Browse (every page): one row of poster cards along the bottom, the focused title's logo, facts and description top left.
 *    Down and up slide whole rows in; Home opens on Continue Watching.
 *  - Pages in the top pill: Home, Shows, Movies, My List (Live exists for `params.page` but has no pill, as in Alder). OK on a page's
 *    name opens it and goes down into it; resting on it opens it (at once when the page is built, else after SWITCH_WAIT: passing
 *    over names builds nothing). Search is the pill's icon.
 *  - Shows and Movies end with genre rows; the chips above jump to them. My List is a grid with filter and sort chips.
 *  - Saved answers draw first and fresh ones replace them (Alder's savedX pattern), so a page is not blank while the network answers.
 *
 *   router.push('home', { page? })
 *
 * v0.2 (docs/PLAN-v0.2.md section E): switching pages was "not so fast". Alder builds a page from scratch every time (it keeps the
 * answers, not the views); here a page is built once and kept: its element (rows or grid, chips, note, caption) is taken out of the
 * document when another page opens, with only the row in use holding cards, and put back, with a 150 ms fade and slide, when it
 * is opened again. Shows, Movies and My List are built behind Home once it has settled (Alder's `warmPages` only read their answers
 * from disk), a piece at a time and only while the remote is quiet. A fresh answer is merged into the rows shown (`mergeItems`,
 * `row.patch`): what did not change is not touched. See DECISIONS.md.
 *
 * Not ported, because Alder has them switched off or they do not exist on this TV: the cinema screensaver and the idle dim (Alder:
 * "off, not wanted yet"), Android TV's Watch Next channel (DECISIONS.md), the update offer (Apps2Samsung updates the app).
 *
 * The page is built from data and only the row in use (and the ones beside it) has cards in the DOM: PLAN.md's budget for this TV.
 * A page is `pg`: { label, el, rowsEl | gridEl, entries, activeEntry, grid, ... } (pageOf below). Rows are `entries`:
 * { key, order, title, items, more, selected, row }. `row` is the mounted createRow, or null.
 */
import { h, clear } from '../lib/dom.js';
import { iconSvg } from '../ui/icons.js';
import { createRow } from '../ui/row.js';
import { createCard, disposeCard } from '../ui/card.js';
import { chip } from '../ui/chip.js';
import { pill } from '../ui/button.js';
import '../ui/navhl.js'; // the top bar's sliding focus highlight (installs itself)
import { openPanel } from '../ui/panel.js';
import { createArt } from '../ui/art.js';
import { runClock } from '../app/clock.js';
import { logoFor, sharp } from '../lib/images.js';
import { log as appLog } from '../lib/log.js';
import { ApiException, NO_SESSION } from '../core/stremio.js';
import * as M from '../app/home-model.js';

const PAD = 96;
const CARD_W = 176;
const CARD_H = 264;
const CARD_GAP = 28;
const ROW_STEP = 440; // px a row takes: heading, room above the cards, the cards, room for the caption below
const GRID_W = 240;
const GRID_H = 360;
const GRID_GAP = 32;
const GRID_STEP = GRID_H + GRID_GAP + 16; // a grid row: room above for the focused poster's growth, the poster, the gap
const GRID_TOP = 544;
const FOCUS_TOP_WAIT = 400; // ms the rows get to answer before the remote starts on the first one
const HERO_TOP_WAIT = 150;
const WARM_GAP = 50; // ms between two pieces of the warm-up (reading and parsing an answer is main-thread work)
const WARM_FALLBACK = 5000; // ms after opening when the warm-up starts even if Home never got a first row
const WARM_PAGES = ['Shows', 'Movies', 'My List'];
const COLUMNS = M.LIST_COLUMNS;

const FILTERS = [['all', 'All'], ['movies', 'Movies'], ['shows', 'Shows']];
const SORTS = [['recent', 'Recently added'], ['name', 'A–Z'], ['unwatched', 'Unwatched first']];

export function createHomeScreen(params = {}) {
  let ctx = null;
  let session = null;
  let root = null;
  let profile = null;
  let dead = false;
  let suspended = false;

  const pages = new Map();   // label -> page (pageOf): built when first wanted, then kept
  let cur = null;            // the page on screen
  let library = [];
  const metas = new Map();   // title id -> Meta: full details, fetched once per title
  const answers = new Map(); // catalogAnswerKey -> [{ metas, saved }]: the rows' answers this session (and from disk)
  let heroItem = null;
  let held = false;          // Left or Right is being held: the row glides instead of stepping
  let jump = false;          // OK on a page's name: go down into its rows once they are in
  let listFilter = 'all';
  let listSort = 'recent';
  let lastKey = 0;           // when a key was last pressed: the warm-up waits for the remote to rest
  let flips = 0;             // pages shown so far (the a/b of the fade-in animation)
  let warmStarted = false;
  const timers = {};
  let flipFrame = 0;
  const idleJobs = [];
  let navItems = null;
  let switcher = null;
  const pool = M.newestFirst(6, (f) => setTimeout(f, 0)); // title details, newest request first

  // ---- DOM shared by the pages ----
  const art = { layer: null };
  let heroEl, titleEl, nameEl, logoImg, factsEl, factsText, ratingEl, scoreEl, addedEl, aboutEl, measureEl, aboutMeasure;
  let headerEl, avatarEl, searchEl, clockEl;
  let stopClock = null;
  let aboutFor = null;
  const fits = new Map(); // description -> the description cut to two lines

  const log = () => (ctx && ctx.log) || appLog;
  const isCatalog = (pg = cur) => M.isCatalogPage(pg.label);
  const inside = (el, within) => !!(el && within && within.contains(el));
  const focusedEl = () => document.activeElement;
  const timer = (name, ms, fn) => { clearTimeout(timers[name]); timers[name] = setTimeout(fn, ms); };
  const tk = (pg, name) => name + ':' + pg.label;

  // ======================================================================================================
  // the frame: art, hero, top bar; and one element per page
  // ======================================================================================================

  function build() {
    art.layer = createArt(ctx.images);
    titleEl = h('div', { class: 'hm-title' });
    nameEl = h('div', { class: 't-hero on-art hm-name' });
    logoImg = h('img', { class: 'hm-logo', alt: '' });
    titleEl.appendChild(nameEl);
    titleEl.appendChild(h('div', { class: 'hm-logobox' }, logoImg));
    factsText = h('span', { class: 'hm-facts-text' });
    ratingEl = h('span', { class: 'imdb', hidden: true }, 'IMDb');
    scoreEl = h('span', { class: 'hm-score', hidden: true });
    addedEl = h('span', { class: 'hm-added t-3', hidden: true });
    factsEl = h('div', { class: 'hm-facts t-small on-art' }, factsText, ratingEl, scoreEl, addedEl);
    aboutEl = h('div', { class: 'hm-about t-body on-art' });
    heroEl = h('div', { class: 'hm-hero' }, titleEl, factsEl, aboutEl);
    aboutMeasure = h('div', { class: 'hm-about t-body on-art' });
    measureEl = h('div', { class: 'hm-hero hm-measure', 'aria-hidden': 'true' }, aboutMeasure);

    buildHeader();
    root.appendChild(art.layer.el);
    root.appendChild(h('div', { class: 'hm-topshade' }));
    root.appendChild(heroEl);
    root.appendChild(measureEl);
    root.appendChild(headerEl);
  }

  /**
   * A page's state and element, made the first time it is wanted. The element holds everything that belongs to the page (rows or
   * grid, note, count, caption, chips) in the stacking order the screen always had; the art, the hero and the top bar are shared.
   */
  function pageOf(label) {
    let pg = pages.get(label);
    if (pg) return pg;
    const gridPage = label === 'My List';
    pg = {
      label, gridPage, gen: 0, loaded: false, ready: false, entries: [], activeEntry: null, grid: null, genre: null, jumpTo: null,
      loadMoreSections: null, refreshLibrary: null, refreshAddons: null, refreshAll: null, syncLibrary: null,
      failedShown: false, emptyNote: false, touched: false, focusedSomething: false, deferred: [], warmItem: null,
      genreChips: new Map(), listChips: [], lastListChip: null,
      shownAt: 0, libraryAt: 0, checkedAt: 0, refreshedAt: 0, libraryStale: false, needsRefresh: false, flip: 0,
    };
    pg.rowsEl = gridPage ? null : h('div', { class: 'hm-rows' });
    pg.gridTrack = gridPage ? h('div', { class: 'hm-grid-track' }) : null;
    pg.gridEl = gridPage ? h('div', { class: 'hm-grid' }, pg.gridTrack) : null;
    pg.noteEl = h('div', { class: 'hm-note', hidden: true });
    pg.countEl = h('div', { class: 't-small t-3 hm-count', hidden: true });
    pg.listHintEl = h('div', { class: 'hm-listhint t-small t-2 glass', hidden: true }, 'Hold OK for options');
    pg.captionText = h('span');
    pg.captionEl = h('div', { class: 'caption glass hm-caption', hidden: true }, pg.captionText);
    pg.hintEl = h('div', { class: 'hm-next caps', hidden: true });
    pg.chipsEl = h('div', { class: 'hm-chips', hidden: true });
    pg.el = h('div', { class: 'hm-page' + (gridPage ? ' hm-gridpage' : '') }, pg.rowsEl || pg.gridEl, pg.noteEl, pg.countEl, pg.listHintEl, pg.captionEl, pg.hintEl, pg.chipsEl);
    pages.set(label, pg);
    return pg;
  }

  /** The profile's round avatar (OK: switch profile, settings), every destination in one capsule with Search first, the clock. */
  function buildHeader() {
    avatarEl = h('div', { class: 'avatar', 'data-focus': '', tabindex: '-1', role: 'button', 'aria-label': 'Profile' }, profile.name.charAt(0).toUpperCase());
    avatarEl.setAttribute('data-left', 'none'); // Left of the first thing in the bar stays on it (it would drop into the page's chips)
    avatarEl.addEventListener('click', profileMenu);
    searchEl = h('div', { class: 'nav-item nav-search', 'data-focus': '', tabindex: '-1', role: 'button', 'aria-label': 'Search' },
      h('span', { class: 'icon', html: iconSvg('search') }));
    searchEl.addEventListener('click', () => ctx.router.push('search', {}));
    navItems = new Map();
    // Which page the remote's resting place opens, and when (M.createPageSwitcher): a page that is built opens at once, one that has
    // to be built waits for the remote to rest, OK never waits.
    switcher = M.createPageSwitcher({
      isBuilt: (label) => { const pg = pages.get(label); return !!(pg && pg.ready); },
      canCommit: (label) => document.activeElement === navItems.get(label),
      commit: (label, how) => {
        cancelAnimationFrame(flipFrame);
        if (how === 'ok') { jump = true; activate(pageOf(label)); return; }
        // Not inside the focus event (a focus move stays cheap) but before that frame is painted: the highlight and the page come together
        flipFrame = requestAnimationFrame(() => { if (document.activeElement === navItems.get(label)) { jump = false; activate(pageOf(label)); } });
      },
    });
    const pill_ = h('div', { class: 'navpill glass' }, searchEl);
    M.NAV_PAGES.forEach((label) => {
      const el = h('div', { class: 'nav-item', 'data-focus': '', tabindex: '-1', role: 'tab' }, label);
      // A page opens as soon as the remote rests on its name. OK on Shows or Movies goes to its genres.
      el.addEventListener('focus', () => { switcher.rest(label, cur.label); });
      el.addEventListener('click', () => {
        if (switcher.ok(label, cur.label)) return; // opened (and the rows are entered once they are in)
        if (isCatalog() || cur.label === 'My List') { const c = chipToFocus(); if (c) ctx.engine.focus(c.el); else focusFirstRow(); } else focusFirstRow();
      });
      // Right of the last name stays on it: with pages kept, the page shown still has cards, and geometry would take the remote down into them
      if (label === M.NAV_PAGES[M.NAV_PAGES.length - 1]) el.setAttribute('data-right', 'none');
      navItems.set(label, el);
      pill_.appendChild(el);
    });
    clockEl = h('div', { class: 'clock' });
    stopClock = runClock(clockEl);
    headerEl = h('div', { class: 'topbar' }, avatarEl, pill_, clockEl);
  }

  /** A tungsten dot marks the open page. */
  function styleNav() {
    navItems.forEach((el, label) => el.classList.toggle('on', !!cur && label === cur.label));
  }

  function profileMenu() {
    const items = ['Switch profile', 'Settings'];
    openPanel(ctx, {
      title: profile.name, items,
      onPick: (i) => { if (i === 0) ctx.router.push('profiles', { pick: true }); else ctx.router.push('settings', {}); },
    });
  }

  // ======================================================================================================
  // the hero: the focused title, top left, and its art across the screen
  // ======================================================================================================

  /** Shows [item]'s art across the screen. The poster only once it is certain there is no art: a cropped poster is blurry. */
  function showArt(item, ready) {
    const url = item.art || (item.settled ? item.poster : null);
    if (!url) return;
    art.layer.show(url, { ready });
  }

  function episodeOf(item) {
    const m = metas.get(item.id);
    return item.videoId && m ? m.videos.find((v) => v.id === item.videoId) || null : null;
  }

  function showHero(item, afterPaint = false) {
    heroItem = item;
    heroEl.classList.add('on');
    nameEl.textContent = item.name;
    titleEl.classList.remove('has-logo');
    ctx.images.load(logoImg, item.logo, { onDone() { if (heroItem === item) titleEl.classList.add('has-logo'); } });
    const meta = metas.get(item.id) || null;
    const ep = episodeOf(item);
    factsText.textContent = M.heroFacts(item, meta, ep);
    const rating = (meta && meta.rating) || (item.facts.find((f) => f.indexOf('IMDb') === 0) || '').replace(/^IMDb /, '');
    ratingEl.hidden = scoreEl.hidden = !rating;
    scoreEl.textContent = rating || '';
    // Leads with a dot only when facts or a rating sit before it (a title with no details yet showed "· Added").
    const lead = !factsText.textContent && !rating ? '' : '·  ';
    addedEl.textContent = item.addedAt ? lead + 'Added ' + M.addedAgo(item.addedAt) : '';
    addedEl.hidden = !(cur.label === 'My List' && addedEl.textContent);
    aboutEl.hidden = cur.label === 'My List';
    const description = (ep && ep.overview && ep.overview.trim() ? ep.overview : null) || item.about || '';
    if (!aboutEl.hidden && aboutFor !== description) { aboutFor = description; aboutEl.textContent = fitAbout(description); }
    // The caption names the focused card: none while the remote is in the top bar, however the hero came to show a title.
    if (inside(focusedEl(), headerEl)) cur.captionEl.hidden = true;
    else if (cur.label === 'Home' || isCatalog()) showCaption(item);
    // A page just opened: its rows paint first, the full-screen picture then cross-fades in behind them (it is the dearest frame).
    if (afterPaint) requestAnimationFrame(() => requestAnimationFrame(() => { if (heroItem === item && !dead) showArt(item); }));
    else showArt(item);
  }

  /** The hero shows nothing (a page with no titles, or one still loading). */
  function hideHero() {
    heroItem = null;
    aboutFor = null;
    heroEl.classList.remove('on');
  }

  /**
   * Two lines of description, cut at a sentence when it is too long (Alder: the layout's ellipsis, then synopsisAtSentence).
   * Measured in a copy of the hero that nobody sees, once per description: the layout reads a cut needs would otherwise run
   * while the hero is changing, and a page's first title is measured ahead, with the page.
   */
  function fitAbout(text) {
    if (fits.has(text)) return fits.get(text);
    aboutMeasure.textContent = text;
    let out = text;
    if (aboutMeasure.scrollHeight > aboutMeasure.clientHeight + 1) {
      let lo = 0;
      let hi = text.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        aboutMeasure.textContent = text.slice(0, mid) + '…';
        if (aboutMeasure.scrollHeight <= aboutMeasure.clientHeight + 1) lo = mid; else hi = mid - 1;
      }
      out = M.synopsisAtSentence(text, lo);
    }
    if (fits.size > 300) fits.clear();
    fits.set(text, out);
    return out;
  }

  function lengthOf(item, meta) {
    if (item.type === 'series') {
      const n = new Set(((meta && meta.videos) || []).map((v) => v.season).filter((s) => s > 0)).size;
      return n > 0 ? M.seasons(n) : null;
    }
    return (meta && meta.runtime) || null;
  }

  /** The line under the focused card: time left and where it stopped, else its name and year (or length). */
  function showCaption(item) {
    const remaining = item.left ? item.left.split(M.DOT).filter((p) => /left$/.test(p)).pop() : null;
    const stop = item.stoppedAt > 0 ? 'Stopped at ' + M.elapsed(item.stoppedAt) : null;
    const meta = metas.get(item.id) || null;
    const detail = cur.label === 'Home' ? (meta && meta.year) || item.facts.find((f) => /^\d/.test(f)) || null : lengthOf(item, meta);
    const parts = [remaining, stop].filter(Boolean);
    cur.captionText.textContent = (parts.length ? parts : [item.name, detail].filter(Boolean)).join(M.DOT);
    cur.captionEl.hidden = false;
    placeCaption();
  }

  /** The caption sits under the focused card, also where the row stops sliding near its end. */
  function placeCaption() {
    const pg = cur;
    const e = pg.activeEntry;
    let x = 0;
    if (e && e.row && inside(focusedEl(), pg.rowsEl)) x = Math.max(0, e.selected * e.row.step - e.row.scroll);
    const room = 1920 - 2 * PAD - pg.captionEl.offsetWidth;
    pg.captionEl.style.transform = 'translate3d(' + Math.max(0, Math.min(x, room)) + 'px,0,0)';
    clearHint(pg);
  }

  /** The next row's name and the caption share one line: a long caption that reaches the name hides it. */
  function clearHint(pg) {
    if (pg !== cur) return; // measured only where it can be (a page out of the document has no widths)
    if (pg.hintEl.hidden || pg.captionEl.hidden) { pg.hintEl.style.visibility = ''; return; }
    const captionEnd = PAD + parseFloat((/translate3d\(([\d.]+)px/.exec(pg.captionEl.style.transform) || [0, 0])[1]) + pg.captionEl.offsetWidth;
    const hintLeft = 1920 - PAD - pg.hintEl.offsetWidth;
    pg.hintEl.style.visibility = captionEnd + 64 > hintLeft ? 'hidden' : '';
  }

  /** Rows below the row in use keep their names hidden (one peeking in at the bottom sat under the caption): the hint names the next. */
  function updateNextRow(pg) {
    if (pg.label !== 'Home' && !isCatalog(pg)) { pg.hintEl.hidden = true; return; }
    // No row in use (the remote is on the chips or the top bar): the row sitting in the band counts.
    const next = pg.entries[Math.max(0, pg.entries.indexOf(pg.activeEntry)) + 1];
    pg.hintEl.textContent = next ? '▾  ' + next.title.toUpperCase() : '';
    pg.hintEl.hidden = !next;
    clearHint(pg);
  }

  // ======================================================================================================
  // titles: details the catalog did not send, fetched once per title from the meta add-on
  // ======================================================================================================

  function fill(item) {
    if (item.filled) return;
    item.filled = true;
    const have = metas.get(item.id);
    if (have) { applyMeta(item, have); return; }
    pool.run((done) => {
      let m = null;
      try { m = session.savedMeta(item.type, item.id); } catch (e) { m = null; }
      const finish = (meta) => {
        done();
        if (dead) return;
        if (!meta) { settle(item); return; }
        metas.set(item.id, meta);
        applyMeta(item, meta);
      };
      if (m) finish(m);
      else session.meta(item.type, item.id).then(finish, () => finish(null));
    });
  }

  function applyMeta(item, m) {
    if (!item.art) item.art = m.background;
    if (!item.logo) item.logo = m.logo;
    if (!item.about) item.about = m.description || '';
    if (!item.facts.length || item.resume) item.facts = M.factsOf(m);
    settle(item);
  }

  /** [item] has all it will get: its card, the hero and whatever waited on it go ahead. */
  function settle(item) {
    item.settled = true;
    if (item.onFill) { const fns = item.onFill; item.onFill = null; fns.forEach((f) => f()); }
    if (!item.poster && item.art) pictureFor(item);
    if (heroItem === item) { aboutFor = null; showHero(item); }
  }

  /** A card whose title has no poster takes the title's art once it is known. */
  function pictureFor(item) {
    const cards = [];
    pages.forEach((pg) => {
      pg.entries.forEach((e) => { if (e.row) e.items.forEach((it, i) => { if (it === item) { const c = e.row.cardAt(i); if (c) cards.push(c); } }); });
      if (pg.grid) pg.grid.mounted.forEach((g) => g.cards.forEach((c, i) => { if (g.items[i] === item) cards.push(c); }));
    });
    cards.forEach((c) => ctx.images.load(c._img, sharp(item.art, 360), { onDone() { c._img.classList.add('on'); c.classList.add('has-img'); } }));
  }

  /** Gets [item]'s full-screen art ready ahead (fetching its details first if need be), so moving to it is instant. */
  function warm(item, more) {
    if (item.warming) { if (more) more(item); return; }
    item.warming = true;
    const ahead = () => { if (item.art) ctx.images.prefetch(sharp(item.art, 1920)); if (item.logo) ctx.images.prefetch(item.logo); if (more) more(item); };
    if (item.art) { ahead(); return; }
    (item.onFill = item.onFill || []).push(ahead);
    fill(item);
  }

  // ======================================================================================================
  // pages
  // ======================================================================================================

  /**
   * Shows page [pg]: the page on screen is put away (its element out of the document, its rows but the one in use dropped), [pg]'s
   * is put in with a fade and slide from the side its tab is on, and the hero names its title. A page that was never built is built
   * now from last time's answers; one that is built is only brought back and, when its answers have gone old, asked again behind.
   */
  function activate(pg) {
    if (pg === cur || dead) return;
    const prev = cur;
    const dir = prev ? Math.sign(M.PAGES.indexOf(pg.label) - M.PAGES.indexOf(prev.label)) : 0;
    if (prev) leave(prev);
    cur = pg;
    pg.shownAt = Date.now();
    pg.touched = false;
    root.insertBefore(pg.el, headerEl);
    flips++;
    pg.el.className = 'hm-page' + (pg.gridPage ? ' hm-gridpage' : '') + ' in-' + (dir > 0 ? 'r' : dir < 0 ? 'l' : '0') + '-' + (flips % 2 ? 'a' : 'b');
    heroEl.classList.toggle('grid', pg.gridPage);
    heroEl.classList.remove('swap-a', 'swap-b');
    heroEl.classList.add(flips % 2 ? 'swap-a' : 'swap-b');
    styleNav();
    if (!pg.loaded) {
      hideHero();
      loadPage(pg, true);
      budget();
      return;
    }
    runDeferred(pg);
    refreshPage(pg);
    const item = heroFor(pg);
    if (item) { fill(item); showHero(item, true); } else { hideHero(); if (pg.gridPage && !pg.grid) art.layer.clear(); }
    unlight(pg);
    updateNextRow(pg);
    if (pg.ready && jump) { jump = false; pg.focusedSomething = true; toCards(); }
    else if (pg.ready) pg.focusedSomething = true;
    budget();
  }

  /** The page on screen goes away: out of the document, and only the row in use keeps its cards. */
  function leave(pg) {
    clearTimeout(timers[tk(pg, 'focusTop')]);
    clearTimeout(timers[tk(pg, 'heroTop')]);
    if (pg.el.parentNode) pg.el.parentNode.removeChild(pg.el);
    const keep = pg.activeEntry || pg.entries[0] || null;
    pg.entries.forEach((e) => { if (e !== keep) dropRow(pg, e); });
    if (pg.grid) mountGridRows(pg, pg.grid.at, 'away');
    pg.captionEl.hidden = true;
  }

  /** The title the hero shows for [pg] while the remote is not in its rows: the one in the band. */
  function heroFor(pg) {
    if (pg.gridPage) return pg.grid ? pg.grid.items[pg.grid.at] || null : null;
    const e = pg.activeEntry || pg.entries[0];
    return e ? e.items[e.selected] || null : null;
  }

  /** Cards alive in all pages together stay within PLAN.md's budget: a hidden page that was left longest lets go of its cards first. */
  function budget() {
    const counts = [];
    pages.forEach((pg) => counts.push({ label: pg.label, cards: cardsIn(pg), used: pg.shownAt }));
    M.pagesToTrim(counts, cur ? cur.label : null, M.CARD_BUDGET).forEach((label) => {
      const pg = pages.get(label);
      pg.entries.forEach((e) => dropRow(pg, e));
      if (pg.grid) mountGridRows(pg, 0, 'none');
    });
  }

  function cardsIn(pg) {
    let n = 0;
    pg.entries.forEach((e) => { if (e.row) n += e.row.mountedCount(); });
    if (pg.grid) pg.grid.mounted.forEach((g) => { n += g.cards.length; });
    return n;
  }

  /**
   * Loads [pg] (built, or built again): from last time's answers kept on disk (library, add-ons, catalogs) at once, and asks the
   * network behind them: catalogs refresh for the next visit, and the library replaces what is shown only if it changed and
   * the remote has not been touched yet. [hidden] builds it behind the page on screen: the pieces wait for the remote to rest
   * (`idle`), nothing is asked of the network, and the page is marked to be asked once it is shown.
   */
  function loadPage(pg, quick = true, hidden = false) {
    const p = pg.label;
    const g = ++pg.gen;
    const gridPage = pg.gridPage;
    const onScreen = () => pg === cur;
    pg.loaded = true;
    pg.ready = false;
    clearTimeout(timers[tk(pg, 'focusTop')]); clearTimeout(timers[tk(pg, 'heroTop')]);
    dropAll(pg);
    clearGrid(pg);
    pg.noteEl.hidden = true;
    pg.emptyNote = false;
    clear(pg.noteEl);
    pg.captionEl.hidden = true;
    pg.hintEl.hidden = true;
    pg.countEl.hidden = !gridPage;
    pg.listHintEl.hidden = !gridPage;
    pg.touched = false;
    pg.focusedSomething = false;
    pg.loadMoreSections = null;
    pg.refreshLibrary = null;
    pg.syncLibrary = null;
    pg.failedShown = false;
    pg.deferred = [];
    pg.needsRefresh = hidden;
    pg.libraryStale = hidden;
    pg.warmItem = null;
    if (onScreen()) hideHero();
    // chips: My List's filter and sort now, Shows' and Movies' genres once the rows tell which are not empty
    if (gridPage) { showListChips(pg); pg.chipsEl.hidden = false; } else if (isCatalog(pg)) { pg.chipsEl.hidden = true; } else { pg.chipsEl.hidden = true; clear(pg.chipsEl); pg.genreChips.clear(); }

    const failedToLoad = (error) => {
      forgetIfSessionGone(error);
      if (pg.failedShown || dead || g !== pg.gen) return;
      pg.failedShown = true;
      pg.noteEl.hidden = false;
      clear(pg.noteEl);
      const again = pill('Try again', { onClick: () => loadPage(pg, true) });
      pg.noteEl.appendChild(h('div', { class: 't-body t-2 on-art' }, "Couldn't reach Stremio. Check the TV's connection."));
      pg.noteEl.appendChild(h('div', { class: 'hm-note-act' }, again));
      if (onScreen() && !pg.focusedSomething && !inside(focusedEl(), headerEl)) ctx.engine.focus(again);
    };

    if (p === 'Home' || p === 'My List') {
      let shown = null; // what is on screen, to tell whether the fresh library changed anything
      let fresh = false;
      const show = (list, force = false) => {
        if (dead || g !== pg.gen) return;
        const cw = session.books.continueWatching(list);
        const what = M.continueSignature(p === 'Home' ? cw : list);
        // Saved copies wait once the remote is in use; Stremio's own answer always goes in (focus stays on its title below), or a
        // stale disk copy could hide a show for the whole visit.
        if (what === shown || (shown !== null && pg.touched && !force)) return;
        const firstShow = shown === null;
        shown = what;
        library = list;
        if (p === 'Home') {
          const was = focusedItemId(pg);
          setContinue(pg, cw.map(M.libraryItem), was, firstShow);
        } else rebuildLibrary(pg, firstShow);
      };
      if (quick && library.length) show(library); // the library already in memory: no wait on a revisit
      if (quick) { const kept = session.savedLibrary(); if (kept && !fresh) show(kept); }
      const ask = () => {
        pg.libraryStale = false;
        session.library({ refresh: true }).then((list) => {
          if (g !== pg.gen) return;
          fresh = true;
          pg.libraryAt = Date.now();
          show(list, true);
        }, (error) => { if (shown === null) failedToLoad(error); else forgetIfSessionGone(error); });
      };
      if (!hidden) ask();
      pg.refreshLibrary = ask;
      pg.syncLibrary = () => { if (library.length) show(library); }; // the library in memory, which another page may have refreshed
    }
    if (p === 'My List') return;

    let built = false;
    let builtFrom = null; // the add-ons the rows came from, to tell when Stremio's fresh list differs
    const buildFrom = (addons) => {
      if (built || g !== pg.gen || dead) return;
      built = true;
      builtFrom = addons.map((a) => a.id);
      buildCatalogs(pg, g, addons, quick, hidden);
    };
    if (quick) { const kept = session.savedAddons(); if (kept) buildFrom(kept); }
    // Every page asks Stremio for the add-on list once as it opens (and again when Alder comes back to the front), and redraws only
    // when the list differs from the one its rows came from: add-ons added or removed elsewhere.
    const checkAddons = (drawn) => session.addons({ refresh: true }).then((fresh) => {
      if (g !== pg.gen || dead) return;
      pg.checkedAt = Date.now();
      if (built && builtFrom.join() !== fresh.map((a) => a.id).join()) loadPage(pg, false); else drawn(fresh);
    }, (error) => { if (!built && g === pg.gen) failedToLoad(error); });
    if (!hidden) checkAddons(buildFrom);
    pg.refreshAddons = () => checkAddons(buildFrom);
  }

  /**
   * A page that was built is shown again: what has gone old is asked again behind it, and what comes back is patched in. A library
   * another page refreshed is read from memory first (no waiting), then the network is asked when it has been a while.
   */
  function refreshPage(pg) {
    const now = Date.now();
    if (pg.syncLibrary) pg.syncLibrary();
    if (pg.refreshLibrary && (pg.libraryStale || M.stale(pg.libraryAt, now, M.LIBRARY_TTL))) pg.refreshLibrary();
    if (pg.refreshAddons && M.stale(pg.checkedAt, now, M.ADDONS_TTL)) pg.refreshAddons();
    if (pg.refreshAll && (pg.needsRefresh || M.stale(pg.refreshedAt, now, M.CATALOGS_TTL))) { pg.needsRefresh = false; pg.refreshAll(); }
  }

  /** Signed out elsewhere (or the session expired): this TV forgets the profile, which can then sign in again. */
  function forgetIfSessionGone(error) {
    if (error instanceof ApiException && error.code === NO_SESSION) {
      session.removeProfile(profile.id);
      ctx.router.reset(session.profiles.all().length ? 'profiles' : 'signin', {});
    }
  }

  // ---- the warm-up: the other pages built behind this one ----

  /** Runs [job] when the remote has been quiet for a while and nothing covers Home: one piece at a time, in order. */
  function idle(job) {
    idleJobs.push(job);
    pump();
  }

  function pump(ms = WARM_GAP) {
    if (timers.idle || !idleJobs.length || dead || suspended) return; // resume() starts it again
    timers.idle = setTimeout(() => {
      timers.idle = null;
      if (dead || suspended) return;
      const quiet = Date.now() - lastKey;
      if (quiet < M.QUIET) { pump(M.QUIET - quiet + 1); return; }
      const job = idleJobs.shift();
      try { job(); } catch (e) { log().warn('home', 'warm-up piece failed: ' + (e && e.message)); }
      budget();
      pump();
    }, ms);
  }

  /** The pieces of a hidden page's build wait for idle time; once the page is shown, whatever is left runs at once. */
  function defer(pg, fn) {
    pg.deferred.push(fn);
    idle(() => { const f = pg.deferred.shift(); if (f) f(); });
  }

  function runDeferred(pg) {
    while (pg.deferred.length) { const f = pg.deferred.shift(); f(); }
  }

  /**
   * Once Home has settled (Alder's warmPages: "the top rows' first posters on Shows and Movies, from last time's catalogs"): the
   * other pages are built behind it from the answers kept on disk, a piece at a time and only while the remote rests, and then
   * asked for fresh answers the same way, so opening them draws at once and nothing is rebuilt when the fresh answers come.
   */
  function startWarm() {
    if (warmStarted || dead) return;
    warmStarted = true;
    if (!session.savedAddons()) return; // nothing kept: the first visit loads it
    WARM_PAGES.forEach((label) => idle(() => {
      const pg = pageOf(label);
      if (pg.loaded) return;
      loadPage(pg, true, true);
      log().debug('home', 'page ' + label + ': built behind Home');
    }));
    WARM_PAGES.forEach((label) => {
      const refresh = () => {
        const pg = pages.get(label);
        // Asked again here only while it is not the page on screen (that one asks as it opens) and it is not asked already.
        if (!pg || pg === cur || !pg.needsRefresh) return;
        if (pg.deferred.length) { idle(refresh); return; } // its last rows are not built yet: they would miss the answers
        pg.needsRefresh = false;
        if (pg.refreshAll) pg.refreshAll();
        if (pg.refreshLibrary) pg.refreshLibrary();
      };
      idle(refresh);
    });
  }

  // ---- catalogs ----

  function buildCatalogs(pg, g, addons, quick, hidden) {
    const p = pg.label;
    const shelves = M.shelvesFor(p, addons);
    const catalogs = shelves.map((s) => s.catalog);
    if (!catalogs.length) {
      const what = p === 'Movies' ? 'movie' : p === 'Live' ? 'live' : 'show';
      showNote(pg, p === 'Home'
        // Home holds only Continue and Watchly's picks, so a new account sees nothing there without a word.
        ? "Picks for you show here once Watchly is installed on this profile's Stremio account. Shows and Movies have more to browse."
        : 'None of your addons has ' + what + ' catalogs. Add one (AIOMetadata, Cinemeta) in Stremio.');
    }
    const genres = M.catalogGenres([].concat(...catalogs.map((c) => c.genres)));
    const sections = M.sectionsFor(p, shelves);
    const isGenre = (name) => genres.some((x) => x.toLowerCase() === name.toLowerCase());
    const genreNames = isCatalog(pg) ? sections.slice(0, M.nextCatalogSection(sections.length, 0)).map((s) => s.title).filter(isGenre) : [];
    const genreResults = {};
    if (isCatalog(pg) && !genreNames.length) { showGenreChips(pg, []); pg.chipsEl.hidden = false; }
    let batchPending = 0;
    let built = 0;
    const refreshers = [];
    pg.refreshedAt = hidden ? 0 : Date.now();
    pg.refreshAll = () => { pg.refreshedAt = Date.now(); refreshers.forEach((f) => f()); };

    const buildSection = (i) => {
      const { title, sources, picked } = sections[i];
      if (isCatalog(pg) && isGenre(title) && genreNames.indexOf(title) < 0) genreNames.push(title);
      built = Math.max(built, i + 1);
      const rowCatalogs = sources.map((s) => s.catalog);
      const key = M.catalogAnswerKey(p, title, picked, rowCatalogs.map((c) => c.addon.transportUrl + '/' + c.type + '/' + c.id));
      const sourceAnswers = rowCatalogs.map(() => null);
      let completed = 0;
      let reported = false;
      let version = 0;

      const onAnswer = (results) => {
        if (g !== pg.gen || dead) return;
        const mine = ++version;
        const items = [];
        const seen = new Set();
        results.forEach((r) => r.metas.forEach((m) => { if (!M.isAddonMessage(m.name) && !seen.has(m.id)) { seen.add(m.id); items.push(M.metaItem(m)); } }));
        if (completed === rowCatalogs.length && !reported) {
          reported = true;
          batchPending--;
          if (batchPending === 0) {
            setTimeout(() => { if (pg.loadMoreSections) pg.loadMoreSections(); }, 0);
            settleTop(pg); // every top row has answered: no need to wait out the timers below
          }
        }
        if (completed === rowCatalogs.length && genreNames.indexOf(title) >= 0) {
          genreResults[title] = items.length > 0;
          // Resolve empty rows before showing chips.
          const ready = M.settledGenres(genreNames, genreResults);
          if (ready) {
            showGenreChips(pg, ready);
            pg.chipsEl.hidden = false;
            if (pg.activeEntry && inside(focusedEl(), pg.rowsEl)) markChip(pg, pg.activeEntry.title);
          }
        }
        // The rest of the first page first, then the add-on's next pages when it takes `skip`.
        // shortcut (Alder's too): genre rows use each source's first page.
        let more;
        if (rowCatalogs.length === 1) {
          const catalog = rowCatalogs[0];
          if (catalog.pages && picked === null) {
            more = (from) => (from < items.length ? Promise.resolve(items.slice(from, from + M.PAGE))
              : catalog.addon.catalogPage(catalog, from).then((ms) => ms.filter((m) => !M.isAddonMessage(m.name)).map(M.metaItem)));
          } else more = later(items);
        } else {
          const all = items.slice();
          const counts = results.map((r) => r.metas.length);
          const exhausted = rowCatalogs.map(() => false);
          more = async (from) => {
            if (from >= all.length && picked === null) {
              for (let j = 0; j < rowCatalogs.length; j++) {
                const catalog = rowCatalogs[j];
                if (!catalog.pages || exhausted[j]) continue;
                const next = await catalog.addon.catalogPage(catalog, counts[j]);
                counts[j] += next.length;
                exhausted[j] = next.length === 0;
                const known = new Set(all.map((x) => x.id));
                next.forEach((m) => { if (!known.has(m.id) && !M.isAddonMessage(m.name)) { known.add(m.id); all.push(M.metaItem(m)); } });
                if (all.length > from) break;
              }
            }
            return all.slice(from, from + M.PAGE);
          };
        }
        if (!items.length) { if (completed === rowCatalogs.length) setTimeout(() => { if (pg.loadMoreSections) pg.loadMoreSections(); }, 0); return; }
        if (mine !== version) return;
        const old = pg.entries.find((e) => e.key === 'sec' + i);
        const shownCount = Math.max(M.START, old ? old.items.length : M.START);
        setCatalogRow(pg, 'sec' + i, i, title, items.slice(0, shownCount), more, items);
        // Nothing to continue: Home's first picture comes from the first catalog's top title (Alder's cinema did this).
        if (i === 0) log().debug('home', 'page ' + p + ': first row in');
        if (pg.jumpTo === title) { pg.jumpTo = null; const e = pg.entries.find((x) => x.key === 'sec' + i); if (e) setTimeout(() => focusEntry(pg, e, 0), 0); }
      };

      // Answers already read this session (or warmed from disk) build the row at once: switching to a page does not wait for the
      // network. A disk answer (saved) refreshes once; after that the row is marked done for the session.
      const update = () => {
        const current = sourceAnswers.map((a) => a || { metas: [], saved: true });
        if (current.some((a) => a.metas.length)) answers.set(key, current);
        onAnswer(current);
      };
      const refresh = (index) => {
        const c = rowCatalogs[index];
        c.addon.catalog(c, picked, M.CATALOG_WAIT).then((ms) => {
          if (g !== pg.gen || dead) return;
          if (ms.length) { sourceAnswers[index] = { metas: ms, saved: false }; update(); }
        }, () => {});
      };
      refreshers.push(() => rowCatalogs.forEach((c, index) => refresh(index)));
      const kept = answers.get(key);
      if (quick && kept && kept.length === rowCatalogs.length) {
        kept.forEach((a, index) => { sourceAnswers[index] = { metas: a.metas, saved: false }; });
        completed = rowCatalogs.length;
        update();
        if (!hidden) kept.forEach((a, index) => { if (a.saved) refresh(index); });
      } else {
        rowCatalogs.forEach((c, index) => {
          let first;
          try {
            const saved = quick ? c.addon.savedCatalog(c, picked) : null;
            first = saved ? Promise.resolve({ metas: saved, saved: true }) : (hidden ? Promise.resolve({ metas: [], saved: true }) : c.addon.catalog(c, picked, M.CATALOG_WAIT).then((ms) => ({ metas: ms, saved: false })));
          } catch (e) { first = Promise.reject(e); }
          first.catch((e) => { log().warn('home', 'row ' + title + ' (' + c.id + ', genre ' + picked + ') failed: ' + (e && e.message)); return { metas: [], saved: false }; })
            .then((answer) => {
              if (g !== pg.gen || dead) return;
              sourceAnswers[index] = answer;
              completed++;
              update();
              if (answer.saved && !hidden) refresh(index);
            });
        });
      }
    };

    let nextSection = M.nextCatalogSection(sections.length, 0);
    batchPending = nextSection;
    // A page built behind another one does its sections one at a time, when the remote rests.
    for (let i = 0; i < nextSection; i++) { if (hidden && i > 0) defer(pg, () => buildSection(i)); else buildSection(i); }
    pg.loadMoreSections = () => {
      const at = pg.entries.indexOf(pg.activeEntry);
      const nearFocus = at >= 0 && pg.activeEntry.section >= 0 && built - 1 - pg.activeEntry.section < 3;
      if (g === pg.gen && nextSection < sections.length && nearFocus) {
        const end = M.nextCatalogSection(sections.length, nextSection);
        batchPending = end - nextSection;
        for (let i = nextSection; i < end; i++) buildSection(i);
        nextSection = end;
      }
    };
  }

  /** The rest of a list already in hand, a page at a time: a row of hundreds of cards would be slow to build. */
  const later = (all) => (all.length <= M.START ? null : (from) => Promise.resolve(all.slice(from, from + M.PAGE)));

  function showNote(pg, text) {
    pg.emptyNote = true;
    pg.noteEl.hidden = false;
    clear(pg.noteEl);
    pg.noteEl.appendChild(h('div', { class: 't-body t-3' }, text));
  }

  // ---- shown rows ----

  const hasFocus = (e) => !!(e.row && inside(focusedEl(), e.row.el));
  const focusedItemId = (pg) => {
    const e = pg.entries.find(hasFocus);
    return e ? (e.items[e.selected] || {}).id || null : null;
  };

  function insertEntry(pg, e) {
    let at = pg.entries.length;
    for (let i = 0; i < pg.entries.length; i++) if (pg.entries[i].order > e.order) { at = i; break; }
    pg.entries.splice(at, 0, e);
    renumber(pg);
  }

  /** Rows sit one band apart; the page slides so the row in use is in the band. */
  function renumber(pg) {
    pg.entries.forEach((e, i) => { e.top = i * ROW_STEP; if (e.row) e.row.el.style.top = e.top + 'px'; });
    place(pg);
  }

  function place(pg) {
    const at = pg.entries.indexOf(pg.activeEntry);
    pg.rowsEl.style.transform = 'translate3d(0,' + (-Math.max(0, at) * ROW_STEP) + 'px,0)';
    pg.entries.forEach((e, i) => {
      if (!e.row) return;
      e.row.el.classList.toggle('away', at >= 0 && i < at);
      e.row.el.classList.toggle('below', at >= 0 && i > at);
    });
  }

  function mountEntry(pg, e) {
    if (e.row) return e.row;
    const row = createRow({
      title: e.title, items: e.items, images: ctx.images, name: 'hm-' + e.key, className: 'hm-row',
      itemWidth: CARD_W, itemHeight: CARD_H, gap: CARD_GAP, padLeft: PAD, safeRight: PAD, slide: true, buffer: 0.5,
      renderItem: (item, i, box) => renderCard(item, i, box, false),
      onSelect: (item) => openDetails(item),
      // Hold OK on a title in progress lists its sources (Alder: play(item, pick = true)).
      onHold: e.kind === 'continue' ? (item) => play(item, true) : null,
      onFocusItem: (item, i) => focusedCard(pg, e, item, i),
    });
    row.el.style.top = e.top + 'px';
    ctx.engine.registerGroup(row.el, row.group);
    e.row = row;
    pg.rowsEl.appendChild(row.el);
    if (e.selected) row.ensure(e.selected);
    place(pg);
    return row;
  }

  function dropRow(pg, e) {
    if (!e.row) return;
    ctx.engine.unregisterGroup(e.row.el);
    e.row.destroy();
    if (e.row.el.parentNode) e.row.el.parentNode.removeChild(e.row.el);
    e.row = null;
  }

  function dropAll(pg) {
    pg.entries.forEach((e) => dropRow(pg, e));
    pg.entries = [];
    pg.activeEntry = null;
    if (pg.rowsEl) { clear(pg.rowsEl); pg.rowsEl.style.transform = ''; }
  }

  function renderCard(item, i, box, tick) {
    const card = createCard({ name: item.name, poster: item.poster, progress: item.progress, watched: tick && item.finished }, i, box, ctx.images);
    if (item.progress > 0) card.classList.add('has-foot');
    return card;
  }

  /**
   * A fresh answer for a row: patched into what is shown. Titles that did not change are the very same items (their cards stay);
   * a changed title gets a new card; the remote stays on the title it was on, wherever it moved. An answer that brings the list
   * already shown changes nothing at all.
   */
  function replaceItems(pg, e, items, more, all) {
    const focused = hasFocus(e);
    const id = e.items[e.selected] ? e.items[e.selected].id : null;
    const merged = M.mergeItems(e.items, items);
    const everything = all ? M.mergeItems(e.all || e.items, all).items : merged.items;
    e.more = more;
    e.all = everything;
    e.fetching = false;
    if (!merged.changed) { updateNextRow(pg); return; }
    e.items = merged.items;
    const at = id ? e.items.findIndex((it) => it.id === id) : -1;
    e.selected = at >= 0 ? at : 0;
    if (e.row) {
      e.row.patch(e.items);
      if (focused && e.row.cardAt(e.selected) !== focusedEl()) focusEntry(pg, e, e.selected);
    } else if (focused) focusEntry(pg, e, e.selected);
    updateNextRow(pg);
  }

  /** A catalog row. A fresh answer for a row the remote is in waits until it leaves (its cards would change under it). */
  function setCatalogRow(pg, key, section, title, items, more, all) {
    const e = pg.entries.find((x) => x.key === key);
    if (!e) {
      insertEntry(pg, { key, kind: 'catalog', order: section + 1, section, title, items, all, more, selected: 0, row: null, top: 0, pending: null, fetching: false });
      rowAdded(pg);
      return;
    }
    if (hasFocus(e)) { e.pending = () => replaceItems(pg, e, items, more, all); return; }
    replaceItems(pg, e, items, more, all);
  }

  /** Home's Continue row: the first row, in place at once (the fresh library always goes in), the remote kept on its title. */
  function setContinue(pg, items, was, firstShow) {
    let e = pg.entries.find((x) => x.key === 'continue');
    if (!items.length) { if (e) { dropRow(pg, e); pg.entries.splice(pg.entries.indexOf(e), 1); if (pg.activeEntry === e) pg.activeEntry = null; renumber(pg); updateNextRow(pg); } return; }
    const more = later(items);
    if (!e) {
      e = { key: 'continue', kind: 'continue', order: 0, section: -1, title: 'Continue', items: items.slice(0, M.START), all: items, more, selected: 0, row: null, top: 0, pending: null, fetching: false };
      insertEntry(pg, e);
      rowAdded(pg);
    } else {
      const keep = Math.max(M.START, e.items.length);
      const at = was ? items.findIndex((it) => it.id === was) : -1;
      replaceItems(pg, e, items.slice(0, Math.max(keep, at + 1)), more, items);
      if (at >= 0) e.selected = at;
    }
    // Continue came in after a quicker row below took the first focus: the remote starts on Continue.
    if (pg === cur && firstShow && !pg.touched && pg.focusedSomething && inside(focusedEl(), pg.rowsEl) && pg.entries[0] === e && pg.activeEntry !== e) focusFirstRow();
  }

  /** A row was added: give slower ones above a moment, then start at the top row, not the quickest. */
  function rowAdded(pg) {
    // The note about missing catalogs belongs to an empty page; with a row on it, it would sit under the cards.
    if (pg.emptyNote) { pg.emptyNote = false; pg.noteEl.hidden = true; }
    pg.ready = true;
    // The first row shows in the band whether or not the remote is in it.
    if (pg.entries[0] && !pg.entries[0].row) mountEntry(pg, pg.entries[0]);
    updateNextRow(pg);
    if (pg !== cur) { prepare(pg); return; }
    if (!pg.focusedSomething) timer(tk(pg, 'focusTop'), FOCUS_TOP_WAIT, () => focusTop(pg));
    // A page opened by resting on its name: the remote stays in the top bar and the top row's first title shows above as soon as
    // the top rows are in (they answer within a few tens of ms of each other).
    if (inside(focusedEl(), headerEl)) timer(tk(pg, 'heroTop'), HERO_TOP_WAIT, () => heroTop(pg));
    if (!warmStarted) timer('warm', M.WARM_AFTER, startWarm);
  }

  /** A page built behind the one on screen gets its first title ready: details, full-screen art, logo, and the description's cut. */
  function prepare(pg) {
    const item = heroFor(pg);
    if (!item || item === pg.warmItem) return;
    pg.warmItem = item;
    warm(item, (it) => { if (it.about) fitAbout(it.about); });
  }

  /** The first batch of rows has answered (all from the disk or all from the network): the remote enters the page or the hero shows. */
  function settleTop(pg) {
    if (pg !== cur || !pg.ready) return;
    if (jump && !pg.focusedSomething) { clearTimeout(timers[tk(pg, 'focusTop')]); focusTop(pg); } else if (inside(focusedEl(), headerEl)) { clearTimeout(timers[tk(pg, 'heroTop')]); heroTop(pg); }
  }

  function focusTop(pg) {
    if (pg !== cur || pg.focusedSomething || dead) return;
    pg.focusedSomething = true;
    if (inside(focusedEl(), headerEl) && !jump) return;
    jump = false;
    focusFirstRow();
  }

  function heroTop(pg) {
    if (pg !== cur || !inside(focusedEl(), headerEl)) return;
    const item = heroFor(pg);
    if (item && item !== heroItem) { fill(item); showHero(item); }
  }

  function focusFirstRow() {
    if (cur.label === 'My List') return gridFocus(cur.grid && cur.grid.at ? cur.grid.at : 0);
    const e = cur.entries[0];
    if (!e) return false;
    return focusEntry(cur, e, e.selected);
  }

  function focusEntry(pg, e, i) {
    const row = mountEntry(pg, e);
    const card = row.focusIndex(Math.min(i, e.items.length - 1));
    return !!card;
  }

  /** The remote reached card [i] of row [e]: it is the row in use, its title brightens, the hero shows it. */
  function focusedCard(pg, e, item, i) {
    pg.focusedSomething = true;
    e.selected = i;
    setActive(pg, e);
    if (pg !== cur) return;
    fill(item);
    showHero(item);
    placeCaption();
    updateNextRow(pg);
    if (e.section >= 0 && pg.label !== 'Home') markChip(pg, e.title);
    if (i >= e.items.length - M.AHEAD) fetchMore(pg, e);
    // Racing past, the cards beside are not where the remote will stop: fetching their art would only queue full-screen
    // downloads and decodes that compete with the row's own pictures.
    if (!held) [i - 1, i + 1].forEach((k) => { if (e.items[k]) warm(e.items[k]); });
    setTimeout(() => { if (pg.loadMoreSections) pg.loadMoreSections(); flushPending(pg); }, 0);
  }

  function setActive(pg, e) {
    const changed = pg.activeEntry !== e;
    if (changed && pg.activeEntry && pg.activeEntry.row) pg.activeEntry.row.el.classList.remove('lit');
    pg.activeEntry = e;
    if (e.row) e.row.el.classList.add('lit');
    place(pg);
    if (changed) {
      // Only the row in use and its neighbours keep cards.
      const at = pg.entries.indexOf(e);
      pg.entries.forEach((x, k) => { if (x.row && Math.abs(k - at) > 1) dropRow(pg, x); });
    }
  }

  /** The remote left the rows: they settle back (cards at full strength, the title quiet). */
  function unlight(pg) {
    if (pg.activeEntry && pg.activeEntry.row) pg.activeEntry.row.el.classList.remove('lit');
  }

  function flushPending(pg) {
    pg.entries.forEach((e) => { if (e.pending && !hasFocus(e)) { const fn = e.pending; e.pending = null; fn(); } });
  }

  /** More titles for a row near its end: a catalog's next page, or the rest of a long library. Stops once an answer brings nothing new. */
  function fetchMore(pg, e) {
    if (!e.more || e.fetching) return;
    e.fetching = true;
    const from = e.items.length;
    Promise.resolve().then(() => e.more(from)).then((got) => {
      e.fetching = false;
      if (dead || pg.entries.indexOf(e) < 0) return;
      const known = new Set(e.items.map((it) => it.id));
      const fresh = got.filter((it) => !known.has(it.id)); // a failed page can be asked again
      if (!fresh.length) { e.more = null; return; }
      e.items = e.items.concat(fresh);
      if (e.row) e.row.append(fresh);
    }, () => { e.fetching = false; });
  }

  /** Moves the remote to the row above or below, onto the same card index. */
  function moveRow(dir) {
    const pg = cur;
    const at = pg.entries.indexOf(pg.activeEntry);
    const next = pg.entries[at + dir];
    if (!next) return false;
    return focusEntry(pg, next, pg.activeEntry.selected);
  }

  // ---- chips ----

  /** All, then one chip per genre row on the page; a chip jumps to its row, and the dot follows the row in use. */
  function showGenreChips(pg, names) {
    const hadFocus = inside(focusedEl(), pg.chipsEl);
    const focusedGenre = hadFocus ? Array.from(pg.genreChips.entries()).filter((kv) => kv[1].el === focusedEl()).map((kv) => kv[0])[0] : undefined;
    clear(pg.chipsEl);
    pg.genreChips.clear();
    [null].concat(names).forEach((value) => {
      const c = chip(value || 'All', { selected: value === pg.genre, onClick: () => {
        const target = value === null ? pg.entries.find((e) => e.section >= 0) || pg.entries[0] : pg.entries.find((e) => e.title === value);
        // Rows far down the page are still being made: the remote goes there as soon as it is in.
        if (target) focusEntry(pg, target, 0); else pg.jumpTo = value;
      } });
      pg.genreChips.set(value, c);
      pg.chipsEl.appendChild(c.el);
    });
    if (hadFocus) { const c = pg.genreChips.get(focusedGenre) || pg.genreChips.get(null); if (c) ctx.engine.focus(c.el); }
  }

  function markChip(pg, rowTitle) {
    const open = pg.genreChips.has(rowTitle) ? rowTitle : null;
    pg.genre = open; // Back and Down from the top bar return to this chip
    pg.genreChips.forEach((c, value) => c.select(value === open));
  }

  /** My List: filter chips, "Sort", sort chips. */
  function showListChips(pg) {
    clear(pg.chipsEl);
    pg.listChips.length = 0;
    const add = (kind, value, label, selected, click) => {
      const c = chip(label, { selected, onClick: click });
      c.el.addEventListener('focus', () => { pg.lastListChip = c; });
      pg.listChips.push({ kind, value, chip: c, label });
      pg.chipsEl.appendChild(c.el);
    };
    FILTERS.forEach(([value, label]) => add('filter', value, label, value === listFilter, () => {
      if (listFilter !== value) { listFilter = value; styleListChips(pg); redrawLibrary(); }
    }));
    pg.chipsEl.appendChild(h('span', { class: 't-small t-3 hm-sort' }, 'Sort'));
    SORTS.forEach(([value, label]) => add('sort', value, label, value === listSort, () => {
      if (listSort !== value) { listSort = value; styleListChips(pg); redrawLibrary(); }
    }));
  }

  function styleListChips(pg) {
    pg.listChips.forEach((c) => c.chip.select(c.kind === 'filter' ? c.value === listFilter : c.value === listSort));
  }

  /** Where Up from the rows (and Down from the top bar) goes first: the chip in use. */
  function chipToFocus() {
    const pg = cur;
    if (pg.label === 'My List') return pg.lastListChip || (pg.listChips.find((c) => c.kind === 'filter' && c.value === listFilter) || {}).chip || null;
    if (isCatalog(pg) && !pg.chipsEl.hidden) return pg.genreChips.get(pg.genre) || pg.genreChips.get(null) || null;
    return null;
  }

  // ======================================================================================================
  // My List: a grid, six across
  // ======================================================================================================

  function clearGrid(pg) {
    if (pg.grid) pg.grid.mounted.forEach((g) => { g.cards.forEach((c) => disposeCard(c, ctx.images)); });
    pg.grid = null;
    if (pg.gridTrack) { clear(pg.gridTrack); pg.gridTrack.style.transform = ''; }
  }

  function showLibrary(pg, first) {
    clearGrid(pg);
    const items = M.listItems(library, listFilter, listSort).map(M.libraryItem);
    const rows = M.listRowCount(items.length, COLUMNS);
    pg.countEl.textContent = items.length ? M.listCountText(1, rows, items.length) : '';
    pg.listHintEl.hidden = !items.length;
    pg.ready = true;
    if (!items.length) {
      if (pg === cur) { hideHero(); art.layer.clear(); }
      const all = M.listItems(library, 'all', 'recent');
      pg.noteEl.hidden = false;
      clear(pg.noteEl);
      pg.noteEl.appendChild(h('div', { class: 't-body t-2' }, !all.length && listFilter === 'all' ? 'Titles you save with + appear here'
        : 'No ' + (listFilter === 'movies' ? 'movies' : listFilter === 'shows' ? 'shows' : 'unwatched titles') + ' in My List'));
      return;
    }
    pg.noteEl.hidden = true;
    pg.grid = { items, rows, mounted: new Map(), at: 0 };
    mountGridRows(pg, 0, pg === cur ? 'full' : 'away');
    if (pg !== cur) { prepare(pg); return; }
    if (first) timer(tk(pg, 'focusTop'), FOCUS_TOP_WAIT, () => focusTop(pg));
    if (inside(focusedEl(), headerEl)) timer(tk(pg, 'heroTop'), HERO_TOP_WAIT, () => heroTop(pg));
  }

  /**
   * The focused row, the one above and two below hold cards ([span] 'full'); a grid out of the document keeps its row in use and
   * the next ('away'), and one that must let go of its cards keeps none ('none').
   */
  function mountGridRows(pg, r, span = 'full') {
    const grid = pg.grid;
    const keep = new Set();
    const from = span === 'none' ? 1 : span === 'away' ? r : Math.max(0, r - 1);
    const to = span === 'none' ? 0 : Math.min(grid.rows - 1, span === 'away' ? r + 1 : r + 2);
    for (let k = from; k <= to; k++) {
      keep.add(k);
      if (grid.mounted.has(k)) continue;
      const slice = grid.items.slice(k * COLUMNS, (k + 1) * COLUMNS);
      const el = h('div', { class: 'hm-grid-row', style: { top: (k * GRID_STEP + 16) + 'px' } });
      const cards = slice.map((item, c) => {
        const card = renderCard(item, k * COLUMNS + c, { left: PAD + c * (GRID_W + GRID_GAP), width: GRID_W, height: GRID_H }, true);
        el.appendChild(card);
        return card;
      });
      pg.gridTrack.appendChild(el);
      grid.mounted.set(k, { el, cards, items: slice });
    }
    Array.from(grid.mounted.keys()).forEach((k) => {
      if (keep.has(k)) return;
      const g = grid.mounted.get(k);
      g.cards.forEach((c) => disposeCard(c, ctx.images));
      if (g.el.parentNode) g.el.parentNode.removeChild(g.el);
      grid.mounted.delete(k);
    });
  }

  function gridCard(i) {
    const g = cur.grid.mounted.get(Math.floor(i / COLUMNS));
    return g ? g.cards[i % COLUMNS] || null : null;
  }

  function gridFocus(i) {
    const pg = cur;
    if (!pg.grid || !pg.grid.items.length) return false;
    i = Math.max(0, Math.min(pg.grid.items.length - 1, i));
    const r = Math.floor(i / COLUMNS);
    mountGridRows(pg, r, 'full');
    pg.gridTrack.style.transform = 'translate3d(0,' + (-r * GRID_STEP) + 'px,0)';
    const card = gridCard(i);
    return card ? ctx.engine.focus(card) : false;
  }

  function focusedGridCard(i) {
    const pg = cur;
    pg.focusedSomething = true;
    pg.grid.at = i;
    const item = pg.grid.items[i];
    pg.countEl.textContent = M.listCountText(Math.floor(i / COLUMNS) + 1, pg.grid.rows, pg.grid.items.length);
    fill(item);
    showHero(item);
    // Racing past, the cards beside are not where the remote will stop.
    if (!held) [i - 1, i + 1].forEach((k) => { if (pg.grid.items[k]) warm(pg.grid.items[k]); });
  }

  function gridKey(a) {
    const pg = cur;
    const i = pg.grid ? pg.grid.at : 0;
    const n = pg.grid ? pg.grid.items.length : 0;
    if (!n) return false;
    const r = Math.floor(i / COLUMNS);
    const c = i % COLUMNS;
    if (a === 'left') { if (c > 0) gridFocus(i - 1); return true; }
    if (a === 'right') { if (c < COLUMNS - 1 && i + 1 < n) gridFocus(i + 1); return true; }
    if (a === 'down') {
      if (r + 1 < pg.grid.rows) gridFocus(Math.min((r + 1) * COLUMNS + c, n - 1));
      return true;
    }
    if (a === 'up') {
      if (r > 0) gridFocus((r - 1) * COLUMNS + c);
      else { const ch = chipToFocus(); if (ch) ctx.engine.focus(ch.el); }
      return true;
    }
    return false;
  }

  /** The grid again from the library in hand (a fresh answer, a filter, a sort): the remote stays on its title, wherever it moved. */
  function rebuildLibrary(pg, first) {
    if (pg.label !== 'My List') return;
    const was = pg.grid ? (pg.grid.items[pg.grid.at] || {}).id : null;
    const hadGrid = pg === cur && !!pg.grid && inside(focusedEl(), pg.gridEl);
    showLibrary(pg, first);
    if (!pg.grid || pg !== cur) return;
    const at = was ? pg.grid.items.findIndex((it) => it.id === was) : -1;
    if (hadGrid) gridFocus(at >= 0 ? at : 0);
    else if (!first) { const it = pg.grid.items[0]; pg.grid.at = 0; if (it) { fill(it); showHero(it); } }
  }

  const redrawLibrary = () => rebuildLibrary(cur, false);

  /** Hold OK on a title: take it out of My List, or mark it watched. Saved to Stremio, then the grid is drawn again. */
  function listMenu(item) {
    const original = library.find((it) => it._id === item.id);
    if (!original) return;
    const options = item.finished ? ['Remove from My List'] : ['Remove from My List', 'Mark as watched'];
    openPanel(ctx, {
      title: item.name, items: options,
      onPick: (selected) => {
        const updated = JSON.parse(JSON.stringify(original));
        if (selected === 0) session.books.setInList(updated, false);
        else session.books.markTitleWatched(updated, (metas.get(item.id) || { videos: [] }).videos);
        session.saveLibrary([updated]).then(() => {
          library = library.map((it) => (it._id === item.id ? updated : it));
          if (cur.label === 'My List' && !dead) redrawLibrary();
          // The other pages built from the library are asked to read it again when they are shown.
          pages.forEach((pg) => { if (pg !== cur) pg.libraryStale = true; });
        }, (error) => {
          forgetIfSessionGone(error);
          if (cur.label === 'My List' && !dead) openPanel(ctx, { title: "Couldn't update My List", items: ['OK'], message: 'Check the connection and try again.' });
        });
      },
    });
  }

  // ======================================================================================================
  // going places
  // ======================================================================================================

  /** Resume: straight to the sources for the episode Continue Watching points at; with [pick] (held OK) they are all listed. */
  function play(item, pick = false) {
    const videoId = item.videoId || item.id;
    const meta = metas.get(item.id) || null;
    const videos = meta ? meta.videos : [];
    const at = videos.findIndex((v) => v.id === videoId);
    const next = at >= 0 ? videos[at + 1] || null : null;
    const video = at >= 0 ? videos[at] : null;
    const code = item.type === 'series' && item.left ? item.left.split(M.DOT)[0] : null;
    ctx.router.push('streams', {
      type: item.type, id: item.id, name: item.name, poster: item.poster, videoId, nextVideoId: next ? next.id : null, pick,
      background: (meta && meta.background) || item.art, logo: (meta && meta.logo) || item.logo,
      still: video ? video.thumbnail : null, runtime: meta ? meta.runtime : null,
      episode: video ? 'S' + video.season + ' E' + video.episode + '  ·  ' + video.title : null,
      label: [item.name, code && /^S/.test(code) ? code : null].filter(Boolean).join('  ·  '),
    });
  }

  function openDetails(item) {
    ctx.router.push('details', { type: item.type, id: item.id, name: item.name, poster: item.poster, background: item.art, videoId: item.videoId });
  }

  // ======================================================================================================
  // keys
  // ======================================================================================================

  function zone() {
    const el = focusedEl();
    if (inside(el, cur.rowsEl)) return 'rows';
    if (inside(el, cur.gridEl)) return 'grid';
    if (inside(el, cur.chipsEl)) return 'chips';
    if (inside(el, headerEl)) return 'header';
    return null;
  }

  /** The card the remote last had, for coming down from the top bar or the chips. */
  function toCards() {
    if (cur.label === 'My List') return gridFocus(cur.grid ? cur.grid.at : 0);
    if (cur.activeEntry) return focusEntry(cur, cur.activeEntry, cur.activeEntry.selected);
    return focusFirstRow();
  }

  function navItem() { return navItems.get(cur.label) || null; }

  function keyDown(a) {
    const z = zone();
    if (z === 'grid') return gridKey(a);
    if (z === 'rows') {
      if (a === 'down') { moveRow(1); return true; }
      if (a === 'up') {
        if (moveRow(-1)) return true;
        // Up from the first row: the chip in use, else the page's name in the top bar.
        const c = chipToFocus();
        if (c) { ctx.engine.focus(c.el); return true; }
        const n = navItem();
        if (n) ctx.engine.focus(n);
        return true;
      }
      return false; // Left and Right: the row keeps them (its ends stop the remote)
    }
    if (z === 'chips') {
      if (a === 'up') { const n = navItem(); if (n) ctx.engine.focus(n); return true; }
      if (a === 'down') { toCards(); return true; }
      return false;
    }
    if (z === 'header') {
      if (a === 'down') {
        // Coming down from the top bar the remote goes to the chips (a page that has them), else to where it was in the rows.
        const c = chipToFocus();
        if (c) { ctx.engine.focus(c.el); return true; }
        toCards();
        return true;
      }
      if (a === 'up') return true;
    }
    return false;
  }

  // ======================================================================================================
  // the screen
  // ======================================================================================================

  return {
    mount(el, p, context) {
      ctx = context;
      session = context.session;
      root = el;
      profile = session.profile();
      if (!profile) { ctx.router.replace('profiles', {}); return; }
      el.classList.add('hm-screen');
      build();
      // The rows in use: lit while the remote is in them; their neighbours and the others settle back when it leaves.
      root.addEventListener('focusin', (e) => {
        if (!inside(e.target, cur.rowsEl)) { unlight(cur); setTimeout(() => flushPending(cur), 0); }
        // The caption names the focused card: none while the remote is up in the top bar.
        if (inside(e.target, headerEl)) cur.captionEl.hidden = true;
        if (inside(e.target, cur.gridEl)) {
          const card = e.target.closest ? e.target.closest('.card') : null;
          if (card && cur.grid) focusedGridCard(Number(card.getAttribute('data-index')));
        }
        if (inside(e.target, cur.chipsEl) && cur.label !== 'My List') { /* the dot follows the row in use; a chip does not move it */ }
      });
      root.addEventListener('click', (e) => {
        if (!inside(e.target, cur.gridEl)) return;
        const card = e.target.closest ? e.target.closest('.card') : null;
        if (card && cur.grid) openDetails(cur.grid.items[Number(card.getAttribute('data-index'))]);
      });
      root.addEventListener('alder:hold', (e) => {
        if (!inside(e.target, cur.gridEl)) return;
        const card = e.target.closest ? e.target.closest('.card') : null;
        if (card && cur.grid) listMenu(cur.grid.items[Number(card.getAttribute('data-index'))]);
      });
      // Dev only: what the page scenarios read (cards alive in every page, which pages are built).
      if (typeof __ALDER_DEV__ !== 'undefined' && __ALDER_DEV__) {
        window.__home = { cards: () => { let n = 0; pages.forEach((pg) => { n += cardsIn(pg); }); return n; },
          pages: () => Array.from(pages.values()).map((pg) => ({ label: pg.label, ready: pg.ready, cards: cardsIn(pg), shown: pg === cur, attached: !!pg.el.parentNode })) };
      }
      activate(pageOf(M.PAGES.indexOf(params.page) >= 0 ? params.page : 'Home'));
      timer('warm', WARM_FALLBACK, startWarm);
    },

    unmount() {
      dead = true;
      cancelAnimationFrame(flipFrame);
      Object.keys(timers).forEach((k) => clearTimeout(timers[k]));
      if (stopClock) stopClock();
      if (art.layer) art.layer.destroy();
      pages.forEach((pg) => { pg.gen++; pg.entries.forEach((e) => dropRow(pg, e)); clearGrid(pg); });
    },

    suspend() { held = false; suspended = true; },

    // Back from a title or the player: Continue Watching may have moved on, so this asks Stremio, not the disk. Only the library's
    // rows are redrawn, so the remote stays where it was on the rest of the page. The pages not on screen read it when shown.
    resume() {
      if (dead) return;
      suspended = false;
      pump();
      pages.forEach((pg) => { if (pg !== cur) pg.libraryStale = true; });
      if (cur.refreshLibrary) cur.refreshLibrary();
      if (cur.refreshAddons) cur.refreshAddons();
    },

    onKey(evt) {
      if (evt.type !== 'press') return false;
      cur.touched = true;
      lastKey = Date.now();
      const a = evt.action;
      if (a === 'left' || a === 'right') { held = !!evt.repeat; if (cur.rowsEl) cur.rowsEl.classList.toggle('held', held); }
      if (a === 'back') {
        // Back from the rows goes up, not out: to the chips on a page that has them (a genre jump left you deep in the page), else
        // to the open page's name. Back from there leaves as usual.
        const z = zone();
        if (z === 'rows' || z === 'grid') {
          if (evt.repeat) return true;
          const c = chipToFocus();
          if (c && c.el && c.el.getClientRects().length) ctx.engine.focus(c.el); else { const n = navItem(); if (n) ctx.engine.focus(n); }
          return true;
        }
        return false;
      }
      if (a === 'up' || a === 'down' || (zone() === 'grid' && (a === 'left' || a === 'right'))) return keyDown(a);
      return false;
    },
  };
}

export const homeScreens = { home: createHomeScreen };
