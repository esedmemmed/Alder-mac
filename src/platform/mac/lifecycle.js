/*
 * Mac player lifecycle, bound to the shared player screen by anchored patches in scripts/build.mjs (the shared src/ stays as it is).
 * The shell's native events (mac/web/bridge.js, window.alderNative.onEvent) and what the page does about them:
 *   sleep        the engine saves the place and pauses (pause + suspend: engine.suspend runs saveAndPause); mpv stays paused
 *   wake         the screen is intact and stays paused, Play resumes (engine.resume restores nothing: it was paused when suspended)
 *   audioDevice  the source reloads at the second it was at, on the new device (mpv.js reload)
 *   willQuit     Cmd-Q, window close: the engine records and pushes FIRST, then the page sends `quit` (the Exit panel does the same)
 * and the fullscreen key (F) and Esc: Esc leaves fullscreen first, then the player. Nothing here carries a link.
 */
import { macBridge } from './bridge.js';

/** createLifecycle({ bridge }) -> { bind, install, fullscreenKey, exit, dispose }. [bridge]: a function answering the bridge or null (default macBridge). */
export function createLifecycle({ bridge = macBridge, log = null } = {}) {
  let player = null; // { engine, avplay } of the player screen open now
  let fullscreen = false;
  let offs = [];
  const say = (m) => { if (log) log.info('mac', m); };

  /** The engine records and pushes (saveAndPause), and the player is left paused. Reversible: engine.resume(). */
  function saveAndHold() {
    if (!player) return;
    try { player.engine.pause(); player.engine.suspend(); } catch (e) { say('save failed: ' + (e && e.message ? e.message : e)); }
  }

  function onSleep() { say('sleep'); saveAndHold(); }
  function onWake() { say('wake'); if (player) player.engine.resume(); }
  function onAudioDevice() {
    if (!player) return;
    const snap = player.engine.snapshot();
    if (player.avplay.isLive()) { say('audio device changed (live: not reloaded)'); return; }
    say('audio device changed: reload at ' + Math.round(snap.position / 1000) + ' s');
    player.avplay.reload(snap.position);
  }
  function onWillQuit() { say('willQuit'); exit(); }

  /** Save, then ask the shell to quit. False (and nothing saved, nothing paused) when there is no native shell. */
  function exit() {
    const b = bridge();
    if (!b) return false;
    saveAndHold();
    b.quit().catch(() => {});
    return true;
  }

  /** The player screen opened: events act on [engine] with [avplay] under it. Returns the unbind function (screen unmount). */
  function bind(engine, avplay) {
    const mine = { engine, avplay };
    player = mine;
    return () => { if (player === mine) player = null; };
  }

  /** Listens to the shell's events; safe to call without a shell. */
  function install() {
    dispose();
    const b = bridge();
    if (!b) return false;
    offs = [b.on('sleep', onSleep), b.on('wake', onWake), b.on('audioDevice', onAudioDevice), b.on('willQuit', onWillQuit)];
    return true;
  }

  function dispose() { offs.forEach((off) => off()); offs = []; }

  function setFullscreen(on) {
    const b = bridge();
    if (!b) return false;
    const was = fullscreen;
    fullscreen = on;
    b.fullscreen(on).catch(() => { fullscreen = was; });
    return true;
  }

  /** The player screen's key hook: F toggles fullscreen; Esc (back) leaves it first. True when the key was used. */
  function fullscreenKey(evt) {
    if (!evt || evt.type !== 'press') return false;
    if (evt.action === 'fullscreen') { if (!evt.repeat) setFullscreen(!fullscreen); return true; }
    if (evt.action === 'back' && fullscreen) { if (!evt.repeat) setFullscreen(false); return true; }
    return false;
  }

  /** Fullscreen was asked for by someone else (the play-check hook): F must now leave it, and Esc leaves it first. */
  function noteFullscreen(on) { fullscreen = !!on; }

  return { bind, install, fullscreenKey, noteFullscreen, exit, dispose, get fullscreen() { return fullscreen; } };
}

// The page's one lifecycle, which scripts/build.mjs's patches (main.js, player/screen.js) call.
const shared = createLifecycle();
export const installMacLifecycle = shared.install;
export const macBindPlayer = shared.bind;
export const macFullscreenKey = shared.fullscreenKey;
export const macNoteFullscreen = shared.noteFullscreen;
/** Asks the shell to quit after the player has saved. Same contract as bridge.js macQuit. */
export const macExit = shared.exit;
