/*
 * Boot: polyfills first (this import must stay first: it patches the engine before any other module runs), then the
 * shell: log handlers, TV keys, focus engine, router, toast, and the first screen.
 */
import './lib/compat.js';
import { installed as polyfilled } from './lib/compat.js';
import { ENV, IS_DEV, VERSION } from './lib/env.js';
import { log, installGlobalHandlers } from './lib/log.js';
import { attachKeys, registerKeys } from './lib/keys.js';
import { createFocusEngine } from './lib/focus.js';
import { createRouter } from './lib/router.js';
import { appImages } from './lib/images.js';
import { createStore } from './lib/store.js';
import { appHttp } from './lib/http.js';
import { createToaster } from './ui/toast.js';
import { openPanel } from './ui/panel.js';
import { createSession } from './app/session.js';
import { firstScreen, playerNavigation } from './app/navigation.js';
import { createTvLanguage } from './player/language.js';
import { playerScreens } from './player/screen.js';
import { diagnosticsScreens } from './screens/diagnostics.js';
import { screensB } from './screens/index.js';
import { profilesScreens } from './screens/profiles.js';
import { signinScreens } from './screens/signin.js';
import { homeScreens } from './screens/home.js';

export function boot() {
  installGlobalHandlers(window, log);
  log.info('boot', 'Alder ' + VERSION + ' (' + ENV + ') ' + navigator.userAgent);
  if (polyfilled.length) log.info('boot', 'polyfills: ' + polyfilled.join(', '));

  const appEl = document.getElementById('app');
  const overlayEl = document.getElementById('overlay');
  const toastHost = document.getElementById('toast');

  const registered = registerKeys(window.tizen);
  log.info('keys', registered.length ? 'registered ' + registered.length + ' TV keys' : 'no TV key registration (desktop browser?)');

  const engine = createFocusEngine({ root: document.body });
  const toast = createToaster(toastHost);
  const params = {};
  if (IS_DEV) new URLSearchParams(window.location.search).forEach((v, k) => { params[k] = v; });

  const context = { engine, toast, images: appImages(), overlayHost: overlayEl, log };
  // The app's services (docs/CONTEXT.md context.session): profiles, settings, add-ons, library, the source finder.
  const session = createSession({
    store: createStore(), http: appHttp(), webapis: window.webapis, log, tvLanguage: createTvLanguage({ log }).get,
  });
  context.session = session;
  const router = createRouter({
    root: appEl,
    screens: Object.assign({}, screensB, profilesScreens, signinScreens, homeScreens, playerScreens, diagnosticsScreens),
    context,
    // Back at the bottom of the stack would leave the app at once: ask first.
    onExit: () => confirmExit(),
    // A screen that gets covered keeps its place: remember the focused card and give it back on return.
    beforeHide: (entry) => { entry.lastFocus = engine.current(); },
    afterShow: (entry) => {
      if (!(entry.lastFocus && entry.lastFocus.isConnected && engine.focus(entry.lastFocus))) engine.focusFirst();
    },
    log,
  });
  context.router = router;

  function exitApp() {
    try {
      window.tizen.application.getCurrentApplication().exit();
    } catch (e) {
      log.info('app', 'exit requested (not on a TV)');
    }
  }
  // "Exit Alder?" with Stay (focused) and Exit: the filled-focus menu used everywhere. Back or Stay closes it, as the
  // menu does for any Back; the router hands Back to the dialog first, so a second Back is "Stay".
  let exitDialog = null;
  function confirmExit() {
    if (exitDialog) return;
    exitDialog = openPanel(context, {
      title: 'Exit Alder?', message: 'Leave the app and go back to the TV.', items: ['Stay', 'Exit'], focus: 0,
      onPick: (i) => { if (i === 1) exitApp(); },
      onClose: () => { exitDialog = null; },
    });
  }
  // What src/player/screen.js reads (its engine's services), from the session. The auth key follows the profile in use.
  context.player = {
    settings: session.settings, library: session.books, memory: session.memory, device: session.device, http: session.http,
    stremio: session.stremio, loadMeta: (type, id) => session.meta(type, id), onNavigate: playerNavigation(router),
  };
  Object.defineProperty(context.player, 'authKey', { get: () => session.authKey(), enumerable: true });

  // The remote: arrows move focus, OK clicks, hold OK sends 'alder:hold'; screens and dialogs see every key first.
  attachKeys({
    target: window,
    onAction: (evt) => {
      if (router.onKey(evt)) return;
      if (evt.type === 'press') {
        if (evt.action === 'left' || evt.action === 'right' || evt.action === 'up' || evt.action === 'down') engine.move(evt.action);
        else if (evt.action === 'ok') engine.press();
      } else if (evt.type === 'hold' && evt.action === 'ok') engine.hold();
    },
  });

  // The TV hides the app (Home key, another source): AVPlay is suspended by the player in Phase 3; here, log it.
  document.addEventListener('visibilitychange', () => log.info('app', document.hidden ? 'hidden' : 'visible'));

  // Dev only (?profile=fixture): the fixture account's profile, so a scenario can start at Home without walking through sign-in.
  if (typeof __ALDER_DEV__ !== 'undefined' && __ALDER_DEV__ && params.profile === 'fixture' && !session.profiles.all().length) {
    session.profiles.add('Enough', 'FIXTURE-AUTH-KEY-0001');
  }
  // No profile: sign in. Several (or one with a PIN): who's watching. One plain profile: straight to Home.
  const first = firstScreen(session.profiles);
  if (first.open) session.profiles.setActive(first.open.id);
  router.push(first.name, first.params);
  if (IS_DEV) {
    window.__alder = { router, engine, log, context };
    // The mock's application.exit() has no TV to close: say what would have happened.
    window.addEventListener('tizen-exit', () => toast('Back at Home leaves the app'));
  }
  log.info('boot', 'ready');
  return { router, engine, context };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
