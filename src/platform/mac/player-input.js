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
 *   click on Back (top left of the bar)   the Back key's end: engine.exit() (save the place, return to the screen playback started from)
 *   Up / Down (no panel or card open), M volume +/- VOLUME_STEP, mute; the level shows for OSD_MS (.mac-osd)
 * Volume rides the wire's `volume` (avplay.setVolume -> setProp): the shell does not allow `mute`, so mute is volume 0 with the level kept.
 * createPlayerInput is DOM-free (hit() and ui are injected: test/platform/mac.player-input.test.js); bindPlayerInput is the DOM glue.
 */
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
 */
export function createPlayerInput({ controls, engine, avplay, fullscreen, hit, menu = null, blocked = () => false, menuOpen = () => false, timers, ui = {} }) {
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
    if (h.kind === 'vol') return true; // the volume buttons act in their own handlers
    if (e.stopPropagation) e.stopPropagation();
    if (h.kind === 'row') {
      if (menu && h.index >= 0) {
        const dir = h.index < h.at ? 'up' : 'down';
        for (let i = Math.abs(h.index - h.at); i > 0; i--) menu.key({ type: 'press', action: dir, repeat: false });
        menu.key({ type: 'press', action: 'ok', repeat: false });
      }
      return true;
    }
    if (h.kind === 'panel') return true;
    if (h.kind === 'back') { if (!blocked()) engine.exit(); return true; }
    if (h.kind === 'btn') {
      if (!blocked()) { controls.show(h.id); controls.key({ type: 'press', action: 'ok', repeat: false }); }
      return true;
    }
    if (h.kind === 'bar') {
      const d = engine.snapshot().duration;
      const f = e.fraction !== undefined ? e.fraction : h.fraction;
      if (!blocked() && d > 0 && f >= 0) engine.seekTo(f * d);
      return true;
    }
    if (menuOpen()) { if (menu) menu.key({ type: 'press', action: 'back', repeat: false }); return true; } // outside the panel: close it like Esc
    if (blocked()) return true;
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
    if (t && options.isOpen() && t.closest('.pl-options') && !t.closest('.pl-options .pl-row')) return { kind: 'panel' };
    const prow = t && options.isOpen() ? t.closest('.pl-options .pl-row') : null;
    if (prow) {
      const all = Array.prototype.slice.call(prow.parentNode.querySelectorAll('.pl-row'));
      return { kind: 'row', index: all.indexOf(prow), at: all.findIndex((r) => r.classList.contains('focus')) };
    }
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
  const bound = createPlayerInput({
    controls, engine, avplay, fullscreen, timers, ui, hit, menu: options,
    blocked: () => options.isOpen() || controls.cardOpen(), menuOpen: () => options.isOpen(),
  });
  mute.addEventListener('click', (e) => { e.stopPropagation(); bound.toggleMute(); });
  down.addEventListener('click', (e) => { e.stopPropagation(); bound.stepVolume(-1); });
  up.addEventListener('click', (e) => { e.stopPropagation(); bound.stepVolume(1); });

  const onClick = (e) => {
    if (!e.isTrusted) return;
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
