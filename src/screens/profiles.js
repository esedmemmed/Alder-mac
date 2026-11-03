/*
 * Who's watching (Alder's ProfilesActivity, picker half): up to five profiles, each its own Stremio account, with an optional PIN
 * and a colour. Hold OK on a portrait (or "Manage profiles") for Rename, PIN, Colour and Remove. A locked profile asks for its PIN
 * before it opens and before anything about it can be changed. Docs/picker.jpg.
 *
 *   router.push('profiles', { pick })      pick: opened from inside a profile (Switch profile): Back returns there
 * Choosing a profile makes it the active one and resets the stack to Home.
 */
import { h, clear } from '../lib/dom.js';
import { log as appLog } from '../lib/log.js';
import { backgroundFor } from '../lib/images.js';
import { pill } from '../ui/button.js';
import { chip, keyHint } from '../ui/chip.js';
import { openPanel } from '../ui/panel.js';
import { createPinEntry } from '../ui/pin.js';
import { createTextField, createOsk, typeFromKeyboard } from '../ui/osk.js';
import { frame, avatar, backdrop, brand, initialOf } from '../ui/onboarding.js';
import { runClock } from '../app/clock.js';
import { COLORS, MAX } from '../core/profiles.js';

const COLOR_NAMES = ['Tungsten', 'Clay', 'Sage', 'Lavender', 'Honey'];

export function createProfilesScreen(params = {}) {
  let ctx = null;
  let session = null;
  let root = null;
  let state = 'picker';
  let backTo = null; // where Back goes from the PIN and rename screens
  let generation = 0; // late answers (a profile's last film) from an earlier picker are dropped
  let stopClock = null;
  let stopTyping = null;
  let field = null;
  let selectedId = null;
  const recent = new Map(); // profile id -> the library item that was watched last
  let art = null;

  const log = () => (ctx && ctx.log) || appLog;
  const profiles = () => session.profiles.all();

  function teardown() {
    generation++;
    if (stopClock) { stopClock(); stopClock = null; }
    if (stopTyping) { stopTyping(); stopTyping = null; }
    field = null;
  }

  /** Runs [then] straight away, or once the profile's PIN is typed, so a locked profile can't be changed around it. */
  function withPin(p, then) {
    if (!p.pin) { then(); return; }
    showPin('Enter ' + p.name + "'s PIN", showPicker, (pin) => { if (pin !== p.pin) return false; then(); return true; });
  }

  function open(p) {
    session.profiles.setActive(p.id);
    log().info('profiles', 'opened profile ' + p.id);
    ctx.router.reset('home');
  }

  // ---------- who's watching ----------

  function showPicker() {
    teardown();
    state = 'picker';
    const mine = generation;
    const list = profiles();
    backTo = params.pick && ctx.router.depth() > 1 ? () => ctx.router.pop() : null;
    if (!list.length) { ctx.router.replace('signin', {}); return; }
    clear(root);

    const active = session.profile();
    let selected = list.find((p) => p.id === selectedId) || list.find((p) => active && p.id === active.id) || list[0];
    selectedId = selected.id;
    art = backdrop();

    const showArt = (p, item) => {
      if (mine !== generation || selected.id !== p.id) return;
      art.show(item ? backgroundFor(item._id) : null, ctx.images);
    };
    const tiles = h('div', { class: 'pk-tiles' });
    list.forEach((p) => {
      const tile = makeTile(p);
      tile.addEventListener('focus', () => { selected = p; selectedId = p.id; if (recent.has(p.id)) showArt(p, recent.get(p.id)); else art.hide(); });
      tile.addEventListener('click', () => withPin(p, () => open(p)));
      tile.addEventListener('alder:hold', () => showMenu(p));
      tiles.appendChild(tile);
      lastFilm(p).then((item) => { if (mine !== generation) return; recent.set(p.id, item); showArt(p, item); }, () => {});
    });
    if (list.length < MAX) {
      const add = makeTile(null);
      add.addEventListener('click', () => ctx.router.push('signin', { addProfile: true }));
      tiles.appendChild(add);
    }
    const clockEl = h('div', { class: 'pk-clock t-small t-2' });
    stopClock = runClock(clockEl);
    const manage = chip('Manage profiles', { onClick: () => {
      openPanel(ctx, { title: 'Manage profiles', items: list.map((p) => p.name), onPick: (i) => showMenu(list[i]) });
    } });

    root.appendChild(h('div', { class: 'pk' }, art.el,
      h('div', { class: 'pk-brand' }, brand()), clockEl,
      h('div', { class: 'pk-title t-hero on-art' }, "Who's here tonight?"),
      tiles,
      h('div', { class: 'pk-manage' }, manage.el),
      h('div', { class: 'pk-hint' }, keyHint('Hold OK', 'Rename · PIN · Colour · Remove'))));
    const first = tiles.children[list.indexOf(selected)];
    ctx.engine.focus(first);
  }

  /** The title a profile watched last, for the backdrop: Continue Watching's first, else the most recently watched. */
  async function lastFilm(p) {
    const items = session.stremio.savedLibrary(p.authKey) || await session.stremio.library(p.authKey);
    const cw = session.books.continueWatching(items)[0];
    if (cw) return cw;
    const seen = items.filter((i) => i.state && i.state.lastWatched);
    return seen.sort((a, b) => (a.state.lastWatched < b.state.lastWatched ? 1 : -1))[0] || null; // compat-ok: unstable sort (a backdrop: ties do not matter)
  }

  function makeTile(p) {
    const add = !p;
    const face = h('div', { class: 'pk-face' + (add ? ' add' : ''), style: add ? null : { background: p.color } }, add ? '+' : initialOf(p.name));
    const name = h('div', { class: 't-body pk-name ellipsis' }, add ? 'Add' : p.name.charAt(0).toUpperCase() + p.name.slice(1) + (p.pin ? '  🔒' : ''));
    return h('div', { class: 'pk-tile', 'data-focus': '', tabindex: '-1', role: 'button' },
      h('div', { class: 'pk-circle' }, face), name, h('div', { class: 'pk-dot' }));
  }

  // ---------- edit a profile ----------

  function showMenu(p) {
    const items = [
      ['Rename', () => withPin(p, () => showRename(p))],
      [p.pin ? 'Change PIN' : 'Set a PIN', () => withPin(p, () => showSetPin(p))],
      ['Colour', () => withPin(p, () => {
        openPanel(ctx, { title: p.name + "'s portrait", items: COLOR_NAMES, checked: COLORS.indexOf(p.color),
          onPick: (i) => { session.profiles.update(p.id, { color: COLORS[i] }); showPicker(); } });
      })],
    ];
    if (p.pin) items.push(['Remove PIN', () => withPin(p, () => { session.profiles.update(p.id, { clearPin: true }); showPicker(); })]);
    items.push(['Remove profile', () => withPin(p, () => { showPicker(); confirmRemove(p); })]);
    openPanel(ctx, { title: p.name, items: items.map((i) => i[0]), onPick: (i) => items[i][1]() });
  }

  function confirmRemove(p) {
    openPanel(ctx, {
      title: 'Remove ' + p.name + '?', items: ['Cancel', 'Remove'],
      message: 'This signs ' + p.name + ' out on this TV. Their Stremio account, history and addons stay as they are.',
      onPick: (i) => {
        if (i === 0) return;
        session.removeProfile(p.id);
        recent.delete(p.id);
        if (selectedId === p.id) selectedId = null;
        if (!profiles().length) ctx.router.replace('signin', {}); else showPicker();
      },
    });
  }

  // ---------- the PIN ----------

  /** Four boxes and a pad; [check](pin) says whether it was accepted (then the caller has moved on). */
  function showPin(title, back, check, errorMessage) {
    teardown();
    state = 'pin';
    backTo = back;
    clear(root);
    const pin = createPinEntry({ title, errorMessage, check });
    root.appendChild(backdrop().el);
    root.appendChild(h('div', { class: 'pk pk-pinscreen' }, h('div', { class: 'pk-brand' }, brand()), pin.el));
    pinEntry = pin;
    ctx.engine.focus(pin.firstKey);
  }
  let pinEntry = null;

  function showSetPin(p) {
    showPin('Choose a PIN for ' + p.name, showPicker, (first) => {
      showPin('Enter it again', showPicker, (second) => {
        if (second !== first) return false;
        session.profiles.update(p.id, { pin: first });
        showPicker();
        return true;
      }, "PINs don't match. Try again.");
      return true;
    });
  }

  // ---------- rename ----------

  function showRename(p) {
    teardown();
    state = 'rename';
    backTo = showPicker;
    clear(root);
    const error = h('div', { class: 't-small ob-error' }, '');
    const previewName = h('div', { class: 't-body bold ob-previewname' }, p.name);
    const portrait = avatar(p.name, p.color, 200);
    const f = createTextField({ placeholder: 'Your name', maxLength: 24, onChange: (v) => { previewName.textContent = v; portrait.setName(v); error.textContent = ''; osk.setShift(v.length === 0); } });
    field = f;
    f.input.value = p.name;
    const osk = createOsk({ field: f, layout: 'name' });
    osk.setShift(false);
    stopTyping = typeFromKeyboard(f, osk);
    const save = pill('Save', { onClick: () => {
      const name = f.value.trim();
      if (!name) { error.textContent = 'Enter a name to save.'; return; }
      session.profiles.update(p.id, { name });
      showPicker();
    } });
    const left = h('div', { class: 'ob-copy' },
      h('div', { class: 't-title' }, 'Rename ' + p.name),
      h('div', { class: 't-body t-2 ob-sub' }, 'History and add-ons stay as they are.'),
      f.el, osk.el, error, save);
    root.appendChild(frame({ left, right: h('div', { class: 'ob-preview' }, portrait, previewName) }));
    ctx.engine.focus(osk.firstKey);
  }

  return {
    mount(el, p, context) {
      ctx = context;
      session = context.session;
      root = el;
      el.classList.add('ob-screen');
      showPicker();
    },
    unmount() { teardown(); },

    onKey(evt) {
      if (state === 'pin' && pinEntry && pinEntry.key(evt)) return true;
      if (evt.type !== 'press' || evt.action !== 'back' || evt.repeat) return false;
      if (field && field.editing) { field.stopEditing(); return true; }
      if (state !== 'picker') { (backTo || showPicker)(); return true; }
      if (backTo) { backTo(); return true; }
      return false; // the first screen of the app: leaves it
    },
  };
}

export const profilesScreens = { profiles: createProfilesScreen };
