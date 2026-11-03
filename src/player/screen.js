/*
 * The player as a screen of the router (Alder's PlayerActivity): it builds the engine, the controls, the options panel
 * and the subtitle overlay, sends the remote's keys where Alder's dispatchKeyEvent sends them, suspends AVPlay when the
 * app is hidden, and hands the engine's "navigate" to whoever opened the player.
 *
 *   router.push('player', params)       params: see engine.js (type, metaId, videoId, name, sources, resumeAt, ...), plus
 *                                       onNavigate(nav, context): where to go when the player is done (the sources
 *                                       page, the next episode, Details; src/app/navigation.js). Without it the player just closes.
 *   context.player                      the app's services for the engine: { library, settings, memory, device, stremio,
 *                                       authKey, http, loadMeta, resolveUrl, tvLanguage, onNavigate }. src/main.js fills it in from the session.
 */
import { createEngine } from './engine.js';
import { createAvplay, attachVideoObject } from './avplay.js';
import { createControls, wallClockText } from './controls.js';
import { createOptions } from './options.js';
import { mediaPlan, focusOnShow, focusAfterClose } from './focus-rules.js';
import { createSubtitleView } from './subtitles.js';
import { createTvLanguage } from './language.js';
import { diag } from './diag.js';
import { h } from '../lib/dom.js';
import { IS_DEV } from '../lib/env.js';
import { log as appLog } from '../lib/log.js';
import { appHttp } from '../lib/http.js';
import { PLAYER } from '../core/playback.js';

const realClock = { now: () => Date.now(), setTimeout: (f, ms) => window.setTimeout(f, ms), clearTimeout: (id) => window.clearTimeout(id) };

/** The clock in the top right: the real time, or a fixed text in dev for screenshots (?clock=11:26%20PM). */
function clockSource() {
  if (IS_DEV) {
    const fixed = new URLSearchParams(window.location.search).get('clock');
    if (fixed) return () => fixed;
  }
  return () => wallClockText(new Date());
}

export function createPlayerScreen(params = {}) {
  let engine = null;
  let controls = null;
  let options = null;
  let subtitles = null;
  let ctx = null;
  let onVisibility = null;
  let root = null;
  let closed = false;

  function navigate(nav) {
    if (closed) return;
    const handler = params.onNavigate || (ctx.player && ctx.player.onNavigate);
    if (handler) { handler(nav, ctx); return; }
    // Nobody to go to (a bare player screen in a test): just leave
    ctx.router.pop();
  }

  /**
   * The media keys (focus-rules.js mediaPlan). Play/Pause acts at once and keeps the controls down: the centre glyph and the
   * dimmed picture say what happened. Fast-forward and rewind bring the controls up on Play/Pause and step 10 s.
   */
  function mediaKey(evt) {
    if (evt.type !== 'press') return false;
    const a = evt.action;
    if (a === 'stop') { engine.exit(); return true; }
    const plan = mediaPlan(a);
    if (!plan) return false;
    if (plan.seek) {
      if (options.isOpen() || controls.cardOpen()) return true;
      controls.show(focusOnShow());
      engine.scrub(plan.seek * PLAYER.SKIP);
    } else if (plan.toggle) controls.quiet(() => engine.togglePlay());
    else if (plan.play) controls.quiet(() => engine.play());
    else if (plan.pause) controls.quiet(() => engine.pause());
    return true;
  }

  return {
    mount(el, p, context) {
      ctx = context;
      root = el;
      const svc = context.player || {};
      const log = context.log || appLog;
      el.classList.add('pl-screen');
      // AVPlay draws on a plane behind the page: the page must be see-through where the picture should show. The dev
      // harness has no such plane (its mock draws nothing), so there the page keeps its dark background.
      if (!IS_DEV) document.documentElement.classList.add('av-live');
      attachVideoObject(el);

      const tv = createTvLanguage({ log });
      const settings = svc.settings;
      const deps = Object.assign({
        avplay: createAvplay({ log }), clock: realClock, log, diag, tvLanguage: tv.get, http: svc.http || appHttp(),
      }, svc);
      deps.tvLanguage = svc.tvLanguage || tv.get;
      engine = createEngine(params, deps);

      const subsHost = h('div', { class: 'pl-subs-host' });
      el.appendChild(subsHost);
      subtitles = createSubtitleView(subsHost, { size: settings ? settings.subtitleSize() : 100, background: settings ? settings.subtitleBackground() : true });
      subtitles.el.style.display = 'none';
      engine.on('subtitle', (d) => { if (d.lines && d.lines.length) subtitles.show(d.lines); else subtitles.hide(); });

      controls = createControls({ host: el, engine, clockText: clockSource(), toast: context.toast, images: context.images });
      options = createOptions({ host: el, engine });
      controls.setSubtitleRaise((up) => subtitles.raise(up));
      controls.onOpenOptions = () => { options.open(); controls.setOptionsOpen(true); };
      controls.onProgress = (s, left) => options.update(s, left);
      options.onClose = () => { controls.setOptionsOpen(false); controls.show(focusAfterClose()); };
      // Up next takes the screen: the options panel goes (Alder's showUpNext sets it GONE)
      engine.on('upNext', () => { if (options.isOpen()) { options.close(true); controls.setOptionsOpen(false); } });
      engine.on('navigate', navigate);

      onVisibility = () => { if (document.hidden) engine.suspend(); else engine.resume(); };
      document.addEventListener('visibilitychange', onVisibility);
      engine.start();
    },

    unmount() {
      closed = true;
      if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
      if (engine) engine.destroy();
      if (options) options.close(true);
      if (controls) controls.destroy();
      if (subtitles) subtitles.destroy();
      document.documentElement.classList.remove('av-live');
    },

    suspend() { if (engine) engine.suspend(); },
    resume() { if (engine) engine.resume(); },

    /** Every key is the player's: nothing falls through to the shell's focus engine. */
    onKey(evt) {
      if (!engine) return true;
      if (mediaKey(evt)) return true;
      if (options.isOpen()) return options.key(evt);
      const handled = controls.key(evt);
      if (!handled && evt.type === 'press' && evt.action === 'back' && !evt.repeat) engine.exit();
      return true;
    },

    /** For the harness and for tests: the engine behind the screen. */
    engine: () => engine,
  };
}

export const playerScreens = { player: createPlayerScreen };
