/*
 * Mac player input: what a mouse, a trackpad and the volume keys do on the shared player screen (src/player/screen.js), bound by anchored
 * patches in scripts/build.mjs (the shared src/ stays as it is; the Tizen build never contains this file).
 *   click on the picture      play / pause, after CLICK_DELAY ms (a double click must not also pause)
 *   double click              fullscreen on / off (the lifecycle's F key path), the pending single click is dropped
 *   click on the bar          acts on the bar only: a button does what OK does on it, the line seeks, the volume buttons set the volume
 *   mouse, pointer, wheel     the controls come up (and the cursor shows); IDLE_MS without any, while playing, they go down and the
 *                             cursor goes with them (class mac-idle on the screen, mac.css)
 *   click on a row of the Audio & subtitles panel   the row is chosen as arrow keys + OK would (the panel's own key handler)
 *   click on the video while the Audio & subtitles panel is open   closes it as Esc does (the panel's Back key); no play / pause
 *     (the video = anywhere outside the visible panel and its bar; the full-screen .pl-options root is not the panel)
 *   click on the video while a card is open (Info, Up next, stall, Source failed)   closes it as Back does; no play / pause
 *   click on Back (top left of the bar)   the Back key's end: engine.exit() (save the place, return to the screen playback started from)
 *   Up / Down (no panel or card open), M volume +/- VOLUME_STEP, mute; the level shows for OSD_MS (.mac-osd)
 * Volume rides the wire's `volume` (avplay.setVolume -> setProp): the shell does not allow `mute`, so mute is volume 0 with the level kept.
 * createPlayerInput is DOM-free (hit() and ui are injected: test/platform/mac.player-input.test.js); bindPlayerInput is the DOM glue.
 */
import { macBridge } from './bridge.js';

export const CLICK_DELAY = 250; // ms a single click waits for a second one
export const IDLE_MS = 3000;    // ms without pointer activity after which the controls and the cursor go
export const VOLUME_STEP = 5;
export const OSD_MS = 1200;
const BAR_END = 18;             // px of the bar line's inset on each side (src/player/bar.js END), in the bar's own 1728 px
const BAR_WIDTH = 1728;
const BUTTON_IDS = ['audio', 'stream', 'play', 'next', 'info']; // the .pl-btn order in controls.js (the dividers are not buttons)

/**
 * hit(target) -> { kind: 'btn', id } | { kind: 'bar', fraction } | { kind: 'vol' } | { kind: 'video' }; a click may carry its own e.fraction (0..1) for the bar
 * hit may also say { kind: 'row', index, at } (a row of the open options panel: its index and the focused row's), { kind: 'panel' } (the open panel, not a row) or { kind: 'back' }.
 * menu: the options panel's key(evt); a row click walks it to the row with Up / Down presses and presses OK.
 * ui: { cursor(on), osd(text), vol(level, muted) }; every one optional.
 * blocked(): the options panel or a card is up (the mouse leaves them alone).
 * menuOpen(): the options panel is up; a click on the video then closes it (menu.key back) instead of pausing.
 * cardOpen(): a card (Info, Up next, stall, Source failed) is up; a click outside its box closes it as Back does (controls.key back).
 *   hit says { kind: 'card' } for a click inside the card's own box (left alone; pointer.js replays it as OK).
 * openName() -> '' | 'options' | 'card:<kind>' and log(open, hitKind, action): one diagnostic line per click while something is up (bridge log).
 * hit() in the DOM glue: the options root (.pl-options) and the card host (.pl-cardhost) are full-screen transparent layers, so only the
 *   visible boxes count (panel, bar, elapsed, left; .pl-card): a click on the layer itself is the video.
 */
export function createPlayerInput({ controls, engine, avplay, fullscreen, hit, menu = null, blocked = () => false, menuOpen = () => false, cardOpen = () => false, openName = () => '', log = null, timers, ui = {} }) {
  const later = timers.setTimeout, cancel = timers.clearTimeout;
  let pending = null, idle = null, osdTimer = null;
  let level = 100, muted = false;
  let pos = { x: -1, y: -1 };
  const toUi = (name, ...a) => { if (ui[name]) ui[name](...a); };

  function applyVolume(text) {
    try { avplay.setVolume(muted ? 0 : level); } catch (e) { /* no bridge: nothing to drive */ }
    toUi('vol', level, muted);
    toUi('osd', text);
    cancel(osdTimer);
    osdTimer = later(() => { osdTimer = null; toUi('osd', null); }, OSD_MS);
  }
  const volumeText = () => (muted ? 'Muted' : 'Volume ' + level);
  function stepVolume(dir) {
    muted = false;
    level = Math.max(0, Math.min(100, level + dir * VOLUME_STEP));
    applyVolume(volumeText());
  }
  function toggleMute() { muted = !muted; applyVolume(volumeText()); }

  function armIdle() {
    cancel(idle);
    idle = later(() => {
      idle = null;
      if (blocked() || !engine.snapshot().playing) return;
      controls.hide(false);
      toUi('cursor', false);
    }, IDLE_MS);
  }

  /** Any mouse, pointer or wheel event over the video. Moves with the same screen position (layout under a still pointer) do not count. */
  function activity(e) {
    if (e && e.type !== 'wheel' && e.screenX !== undefined) {
      const moved = e.screenX !== pos.x || e.screenY !== pos.y;
      pos = { x: e.screenX, y: e.screenY };
      if (!moved && e.type !== 'pointerdown') return;
    }
    toUi('cursor', true);
    if (!blocked()) controls.show(null);
    armIdle();
  }

  function click(e) {
    if (e.isTrusted === false) return false;
    const h = hit(e.target);
    const open = log ? openName() : ''; // what is up before this click acts (a close changes it)
    const say = (action) => { if (open) log(open, h.kind, action); return true; };
    if (h.kind === 'vol') return say('vol'); // the volume buttons act in their own handlers
    if (e.stopPropagation) e.stopPropagation();
    if (h.kind === 'row') {
      if (menu && h.index >= 0) {
        const dir = h.index < h.at ? 'up' : 'down';
        for (let i = Math.abs(h.index - h.at); i > 0; i--) menu.key({ type: 'press', action: dir, repeat: false });
        menu.key({ type: 'press', action: 'ok', repeat: false });
      }
      return say('row');
    }
    if (h.kind === 'panel') return say('panel');
    if (h.kind === 'card') return say('card'); // inside a card's own box: pointer.js replays it as OK
    if (h.kind === 'back') { if (!blocked()) engine.exit(); return say('back'); }
    if (h.kind === 'btn') {
      if (!blocked()) { controls.show(h.id); controls.key({ type: 'press', action: 'ok', repeat: false }); }
      return say('btn');
    }
    if (h.kind === 'bar') {
      const d = engine.snapshot().duration;
      const f = e.fraction !== undefined ? e.fraction : h.fraction;
      if (!blocked() && d > 0 && f >= 0) engine.seekTo(f * d);
      return say('bar');
    }
    if (menuOpen()) { if (menu) menu.key({ type: 'press', action: 'back', repeat: false }); return say('close'); } // outside the panel: close it like Esc
    if (cardOpen()) { controls.key({ type: 'press', action: 'back', repeat: false }); return say('close'); } // outside the card: close it like Back
    if (blocked()) return say('ignored');
    if (e.detail >= 2) { cancel(pending); pending = null; return true; } // the second click of a double click
    cancel(pending);
    pending = later(() => { pending = null; controls.quiet(() => engine.togglePlay()); }, CLICK_DELAY);
    return true;
  }

  function dblclick(e) {
    if (hit(e.target).kind !== 'video' || blocked()) return false;
    cancel(pending);
    pending = null;
    fullscreen({ type: 'press', action: 'fullscreen', repeat: false });
    return true;
  }

  /** The screen's key hook: M and Up / Down with the bar hidden. True when the key was used. */
  function key(evt) {
    if (!evt || evt.type !== 'press' || blocked()) return false;
    if (evt.action === 'mute') { if (!evt.repeat) toggleMute(); return true; }
    if ((evt.action === 'up' || evt.action === 'down') && true) { stepVolume(evt.action === 'up' ? 1 : -1); return true; }
    return false;
  }

  function dispose() { cancel(pending); cancel(idle); cancel(osdTimer); pending = idle = osdTimer = null; }

  return { click, dblclick, activity, key, stepVolume, toggleMute, dispose, state: () => ({ level, muted }) };
}

/** The DOM glue: listeners on [win].document while the player screen is up, the volume buttons in the bar, the level on screen. */
let current = null; // the bound player's input, for macPlayerKey

export function bindPlayerInput({ root, controls, options, engine, avplay, fullscreen, win = window }) {
  const doc = win.document;
  const timers = { setTimeout: (f, ms) => win.setTimeout(f, ms), clearTimeout: (id) => win.clearTimeout(id) };
  const mk = (cls, text, tag = 'div') => { const el = doc.createElement(tag); el.className = cls; if (text != null) el.textContent = text; return el; };

  const bar = controls.el.querySelector('.pl-controls');
  const level = mk('mac-vol-level', '100');
  const mute = mk('mac-vol-btn', 'Mute', 'button');
  const down = mk('mac-vol-btn', '−', 'button');
  const up = mk('mac-vol-btn', '+', 'button');
  const vol = mk('mac-vol');
  [mute, down, up, level].forEach((el) => vol.appendChild(el));
  if (bar) bar.appendChild(vol);
  const osd = mk('mac-osd');
  root.appendChild(osd);

  const ui = {
    cursor: (on) => root.classList.toggle('mac-idle', !on),
    osd: (text) => { if (text == null) osd.classList.remove('on'); else { osd.textContent = text; osd.classList.add('on'); } },
    vol: (l, muted) => { level.textContent = muted ? 'Muted' : String(l); mute.textContent = muted ? 'Unmute' : 'Mute'; },
  };
  const hit = (target) => {
    const t = target && target.closest ? target : null;
    if (t && t.closest('.mac-vol')) return { kind: 'vol' };
    if (t && t.closest('.mac-back')) return { kind: 'back' };
    const prow = t && options.isOpen() ? t.closest('.pl-options .pl-row') : null;
    // the visible menu only: the .pl-options root is a transparent full-screen layer and counts as the video
    if (t && options.isOpen() && !prow && t.closest('.pl-opt-panel, .pl-opt-bar, .pl-opt-elapsed, .pl-opt-left')) return { kind: 'panel' };
    if (prow) {
      const all = Array.prototype.slice.call(prow.parentNode.querySelectorAll('.pl-row'));
      return { kind: 'row', index: all.indexOf(prow), at: all.findIndex((r) => r.classList.contains('focus')) };
    }
    if (t && controls.cardOpen() && t.closest('.pl-card')) return { kind: 'card' };
    const btn = t && t.closest('.pl-btn');
    if (btn) {
      const cells = Array.prototype.filter.call(btn.closest('.pl-buttons').children, (c) => c.classList.contains('pl-cell'));
      return { kind: 'btn', id: BUTTON_IDS[cells.indexOf(btn.parentNode)] || 'play' };
    }
    if (t && t.closest('.pl-mainbar')) return { kind: 'bar', fraction: -1 };
    return { kind: 'video' };
  };
  // The line seeks where it was pressed: the fraction comes from the click's position on the bar (the page is scaled: use the rectangle).
  const barFraction = (e) => {
    const r = e.target.closest('.pl-mainbar').getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * BAR_WIDTH;
    return Math.max(0, Math.min(1, (px - BAR_END) / (BAR_WIDTH - 2 * BAR_END)));
  };
  const back = mk('mac-back', '‹  Back', 'button');
  if (bar) bar.appendChild(back);
  let lastTarget = null;
  const cardKind = () => {
    const c = controls.el.querySelector('.pl-card');
    const cl = c ? c.classList : null;
    return !cl ? '?' : cl.contains('pl-info') ? 'info' : cl.contains('pl-upnext') ? 'upnext' : cl.contains('pl-error') ? 'error' : 'stall';
  };
  const describe = (t) => {
    if (!t || !t.tagName) return '?';
    const c = typeof t.className === 'string' ? t.className : (t.getAttribute && t.getAttribute('class')) || '';
    return t.tagName.toLowerCase() + (c ? '.' + c.trim().split(/\s+/).join('.') : '');
  };
  // one bridge log line per click while a menu or card is up (the shell's report carries it as `log: ...`); no links, no addresses
  const log = (open, kind, action) => {
    const b = macBridge(win);
    if (!b || !b.log) return;
    try { const p = b.log('menu-click: open=' + open + ' target=' + describe(lastTarget) + ' kind=' + kind + ' action=' + action); if (p && p.catch) p.catch(() => {}); } catch (e) { /* no shell */ }
  };
  const bound = createPlayerInput({
    controls, engine, avplay, fullscreen, timers, ui, hit, menu: options, log,
    blocked: () => options.isOpen() || controls.cardOpen(), menuOpen: () => options.isOpen(), cardOpen: () => controls.cardOpen(),
    openName: () => (options.isOpen() ? 'options' : controls.cardOpen() ? 'card:' + cardKind() : ''),
  });
  mute.addEventListener('click', (e) => { e.stopPropagation(); bound.toggleMute(); });
  down.addEventListener('click', (e) => { e.stopPropagation(); bound.stepVolume(-1); });
  up.addEventListener('click', (e) => { e.stopPropagation(); bound.stepVolume(1); });

  const onClick = (e) => {
    if (!e.isTrusted) return;
    lastTarget = e.target;
    const h = hit(e.target);
    bound.click(h.kind === 'bar' ? { target: e.target, detail: e.detail, stopPropagation: () => e.stopPropagation(), fraction: barFraction(e) } : e);
  };
  const onDbl = (e) => bound.dblclick(e);
  const onAct = (e) => bound.activity(e);
  const ACT = ['mousemove', 'pointermove', 'pointerdown', 'wheel'];
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('dblclick', onDbl, true);
  ACT.forEach((n) => doc.addEventListener(n, onAct, { capture: true, passive: true }));

  current = bound;
  return () => {
    if (current === bound) current = null;
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('dblclick', onDbl, true);
    ACT.forEach((n) => doc.removeEventListener(n, onAct, { capture: true }));
    bound.dispose();
    root.classList.remove('mac-idle');
    if (vol.parentNode) vol.parentNode.removeChild(vol);
    if (back.parentNode) back.parentNode.removeChild(back);
    if (osd.parentNode) osd.parentNode.removeChild(osd);
  };
}

/** The patched screen's key hook (scripts/build.mjs): false when no player is bound. */
export const macPlayerKey = (evt) => (current ? current.key(evt) : false);
export const macBindInput = bindPlayerInput;
