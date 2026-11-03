/*
 * Adding a profile: its name and colour, then Stremio's TV sign-in (a link code and a QR: the person approves it on their phone, the
 * app never sees a password), then, for a second or later profile, Watchly's set-up. A port of ProfilesActivity.kt's showName(),
 * showSignIn(), poll(), showWatchly() and showReady(). Added for Tizen: sign in with an e-mail and password as a second way in
 * (a chip under the code), through api.strem.io `login`.
 *
 *   router.push('signin', { addProfile })      addProfile: the picker opened it (Back returns there); without it this is the
 *                                              first launch (Back leaves the app).
 * Done: router.reset('home') with the new profile active.
 */
import { h, clear } from '../lib/dom.js';
import { log as appLog } from '../lib/log.js';
import { pill } from '../ui/button.js';
import { chip } from '../ui/chip.js';
import { frame, avatar, swatches } from '../ui/onboarding.js';
import { createTextField, createOsk, typeFromKeyboard } from '../ui/osk.js';
import { qrSvg } from '../ui/qr.js';
import { COLORS, MAX } from '../core/profiles.js';
import { createLinkPoller, EXPIRE_MS } from '../app/link-poller.js';

const titlecase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const mmss = (secs) => Math.trunc(secs / 60) + ':' + String(secs % 60).padStart(2, '0');

export function createSigninScreen(params = {}) {
  let ctx = null;
  let session = null;
  let root = null;
  let state = 'name';
  let poller = null;
  let stopTyping = null;
  let field = null; // the text field of the state on screen, for Back while the TV's keyboard has it
  const draft = { name: '', color: COLORS[0] };
  let first = true;

  const log = () => (ctx && ctx.log) || appLog;
  const toState = (next) => { state = next; render(); };
  const step = (now, total) => ({ now, total, label: (total > 2 ? 'New profile · ' : 'Welcome · ') + 'step ' + now + ' of ' + total });

  function stopAll() {
    if (poller) { poller.stop(); poller = null; }
    if (stopTyping) { stopTyping(); stopTyping = null; }
    field = null;
  }

  function render() {
    stopAll();
    clear(root);
    ({ name: renderName, code: renderCode, email: renderEmail, ready: renderReady }[state])();
  }

  // ---------- name and colour ----------

  function renderName() {
    const error = h('div', { class: 't-small ob-error' }, '');
    const previewName = h('div', { class: 't-body bold ob-previewname' }, draft.name);
    const portrait = avatar(draft.name, draft.color, 200);
    const f = createTextField({ placeholder: 'Your name', maxLength: 24, onChange: (v) => {
      draft.name = v; previewName.textContent = v; portrait.setName(v); error.textContent = '';
      osk.setShift(v.length === 0); // names start with a capital: on while the box is empty
    } });
    field = f;
    f.input.value = draft.name;
    const osk = createOsk({ field: f, layout: 'name' });
    osk.setShift(draft.name.length === 0);
    stopTyping = typeFromKeyboard(f, osk);

    const go = () => {
      const name = draft.name.trim();
      if (!name) { error.textContent = 'Enter a name to continue.'; return; }
      draft.name = titlecase(name);
      toState('code');
    };
    const next = pill('Continue    →', { onClick: go });
    const colors = swatches(draft.color, (c) => { draft.color = c; portrait.setColor(c); });

    const left = h('div', { class: 'ob-copy' },
      h('div', { class: 't-title' }, first ? 'Welcome to Alder' : 'New profile'),
      h('div', { class: 't-body t-2 ob-sub' }, 'Give this profile a name and colour.'),
      f.el, osk.el,
      h('div', { class: 'caps ob-caps' }, 'Portrait colour'), colors.el, error, next);
    const right = h('div', { class: 'ob-preview' }, portrait, previewName);
    root.appendChild(frame({ step: step(1, first ? 2 : 3), left, right }));
    ctx.engine.focus(osk.firstKey);
  }

  // ---------- the link ----------

  function renderCode() {
    const qrBox = h('div', { class: 'ob-qr' });
    const status = h('span', { class: 't-small t-2 ob-status' }, 'Getting a sign-in code…');
    const ring = h('span', { class: 'ob-ring', html: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="2"/>'
      + '<circle class="arc" cx="10" cy="10" r="8" fill="none" stroke="#f3d9b1" stroke-width="2" stroke-linecap="round" transform="rotate(-90 10 10)" stroke-dasharray="50.3" stroke-dashoffset="0"/></svg>' });
    const tiles = h('div', { class: 'ob-codetiles' });
    const backChip = chip('← Back', { onClick: () => toState('name') });
    const emailChip = chip('Sign in with e-mail instead', { onClick: () => toState('email') });

    const left = h('div', { class: 'ob-codecard glass' }, qrBox,
      h('div', { class: 'ob-who' }, avatar(draft.name, draft.color, 52), h('span', { class: 't-body bold' }, draft.name)));
    const link = h('span', { class: 'ob-link' }, 'link.stremio.com');
    const right = h('div', { class: 'ob-copy' },
      h('div', { class: 'ob-h1' }, 'Connect Stremio'),
      h('div', { class: 't-body ob-line' }, 'Scan with ' + draft.name + "'s phone. Stremio opens and asks to sign in this TV."),
      h('div', { class: 't-body t-2 ob-line2' }, 'Or go to ', link, ' and enter'),
      tiles,
      h('div', { class: 'ob-statusrow' }, ring, status),
      h('div', { class: 't-small t-3 ob-new' }, 'New to Stremio? Make an account and add your add-ons in the Stremio app or at web.stremio.com. Alder brings them to the TV.'));
    const fr = frame({ step: step(2, first ? 2 : 3), left, right, leftWidth: 600 });
    fr.appendChild(h('div', { class: 'ob-bottom' }, backChip.el, emailChip.el));
    root.appendChild(fr);
    ctx.engine.focus(backChip.el);

    poller = createLinkPoller({
      stremio: session.stremio,
      onCode: ({ code, url }) => {
        qrBox.innerHTML = qrSvg(url);
        clear(tiles);
        code.split('').filter((c) => c !== '-').forEach((c) => tiles.appendChild(h('div', { class: 'ob-codetile glass' }, c)));
        log().info('signin', 'link code ready');
      },
      onTick: (left) => {
        status.textContent = 'Waiting for your phone · new code in ' + mmss(left);
        const arc = ring.querySelector('.arc');
        if (arc) arc.setAttribute('stroke-dashoffset', String(50.3 * (1 - left * 1000 / EXPIRE_MS)));
      },
      onTrouble: (message) => { status.textContent = message; },
      onApproved: (authKey) => approved(authKey),
    });
    poller.start();
  }

  /** The person approved the code (or signed in with a password): the profile is added and made the active one. */
  function approved(authKey) {
    const others = session.profiles.all();
    let profile;
    try { profile = session.profiles.add(draft.name, authKey, draft.color); } catch (e) {
      ctx.toast('This TV has ' + MAX + ' profiles already. Remove one first.');
      ctx.router.reset('profiles');
      return;
    }
    log().info('signin', 'profile ' + profile.id + ' added');
    draft.profile = profile;
    if (others.length === 0) { ctx.router.reset('home'); return; }
    // Each profile brings its own add-ons (stream add-ons are shared in Settings, never copied); the others' lists only tell
    // where Watchly lives, so the new profile can set up its own.
    Promise.all(others.map((o) => session.stremio.addons(o.authKey).catch(() => []))).then((lists) => {
      if (state === 'ready') return;
      draft.watchly = [].concat(...lists).find((a) => a.name.toLowerCase().includes('watchly')) || null;
      toState('ready');
    });
  }

  // ---------- e-mail and password ----------

  function renderEmail() {
    let stage = 'email';
    let email = '';
    const error = h('div', { class: 't-small ob-error' }, '');
    const title = h('div', { class: 't-title' }, 'Sign in with e-mail');
    const sub = h('div', { class: 't-body t-2 ob-sub' }, '');
    const holder = h('div', { class: 'ob-emailbox' });
    let osk = null;
    let busy = false;

    function show() {
      if (stopTyping) { stopTyping(); stopTyping = null; }
      clear(holder);
      const isPassword = stage === 'password';
      sub.textContent = isPassword ? 'Enter ' + draft.name + "'s Stremio password." : "Enter the e-mail of " + draft.name + "'s Stremio account.";
      const f = createTextField({ placeholder: isPassword ? 'Password' : 'E-mail', password: isPassword, maxLength: 128, onChange: () => { error.textContent = ''; } });
      field = f;
      osk = createOsk({ field: f, layout: 'email', submitLabel: isPassword ? 'Sign in' : 'Next', onSubmit: submit });
      stopTyping = typeFromKeyboard(f, osk);
      holder.appendChild(f.el);
      holder.appendChild(osk.el);
      ctx.engine.focus(osk.firstKey);
    }

    async function submit() {
      if (busy) return;
      const value = field.value;
      if (stage === 'email') {
        if (!/^\S+@\S+\.\S+$/.test(value.trim())) { error.textContent = 'Enter the e-mail address.'; return; }
        email = value.trim();
        stage = 'password';
        show();
        return;
      }
      if (!value) { error.textContent = 'Enter the password.'; return; }
      busy = true;
      error.textContent = 'Signing in…';
      try {
        const authKey = await session.login(email, value);
        busy = false;
        approved(authKey);
      } catch (e) {
        busy = false;
        if (state !== 'email') return;
        // Never log the request: it carries the password. Stremio's own message is plain ("Wrong e-mail or password").
        error.textContent = e && e.name === 'ApiException' && e.message ? e.message : "Can't reach Stremio. Check the TV's connection.";
        log().warn('signin', 'e-mail sign-in failed' + (e && e.code ? ' (' + e.code + ')' : ''));
        stage = 'password';
        show();
      }
    }

    const back = chip('← Back', { onClick: () => { if (stage === 'password') { stage = 'email'; show(); } else toState('code'); } });
    const left = h('div', { class: 'ob-copy' }, title, sub, holder, error);
    const right = h('div', { class: 'ob-preview' }, avatar(draft.name, draft.color, 200), h('div', { class: 't-body bold ob-previewname' }, draft.name));
    const fr = frame({ step: step(2, first ? 2 : 3), left, right });
    fr.appendChild(h('div', { class: 'ob-bottom' }, back.el));
    root.appendChild(fr);
    show();
    emailBack = () => { if (field && field.editing) { field.stopEditing(); return; } back.el.click(); };
  }
  let emailBack = null;

  // ---------- done ----------

  function renderReady() {
    const profile = draft.profile;
    const go = pill('Continue to Alder', { onClick: () => ctx.router.reset('home') });
    const name = profile ? profile.name : draft.name;
    let left, right;
    if (draft.watchly) {
      // Watchly is per person: the new profile sets up its own, connected to its own Stremio account.
      const u = new URL(draft.watchly.transportUrl);
      const configure = u.protocol + '//' + u.host + '/configure';
      left = h('div', { class: 'ob-codecard glass ob-watchly' }, h('div', { class: 'ob-qr small', html: qrSvg(configure) }), h('div', { class: 't-body bold ob-who' }, name));
      right = h('div', { class: 'ob-copy' },
        h('div', { class: 't-title bold' }, 'Recommendations for ' + name),
        h('div', { class: 't-body t-3 ob-steps' },
          '1.  Scan with ' + name + "'s phone to open Watchly", h('br'),
          '2.  Connect ' + name + "'s Stremio account there", h('br'),
          '3.  Install it to ' + name + "'s Stremio account", h('br'), h('br'),
          name + '\'s own "Top Picks" then show up on Home. You can finish this later.'),
        h('div', { class: 'ob-go' }, go));
    } else {
      left = h('div', { class: 'ob-preview' }, avatar(name, profile ? profile.color : draft.color, 200), h('div', { class: 't-title ob-previewname' }, name));
      right = h('div', { class: 'ob-copy' },
        h('div', { class: 'ob-h1' }, "You're all set"),
        h('div', { class: 't-body t-2 ob-line' }, name + "'s profile is ready. You can add more add-ons later in Settings."),
        h('div', { class: 'ob-go' }, go));
    }
    root.appendChild(frame({ step: step(3, 3), left, right, leftWidth: 600 }));
    ctx.engine.focus(go);
  }

  return {
    mount(el, p, context) {
      ctx = context;
      session = context.session;
      root = el;
      first = session.profiles.all().length === 0;
      el.classList.add('ob-screen');
      render();
    },

    unmount() { stopAll(); },

    onKey(evt) {
      if (evt.type !== 'press' || evt.action !== 'back' || evt.repeat) return false;
      if (field && field.editing) { field.stopEditing(); return true; } // the TV's keyboard has it: Back closes that first
      if (state === 'code') { toState('name'); return true; }
      if (state === 'email') { emailBack(); return true; }
      if (state === 'ready') { ctx.router.reset('home'); return true; }
      if (state === 'name' && params.addProfile) return false; // the router pops back to the picker
      return false; // the first launch: leaves the app
    },
  };
}

export const signinScreens = { signin: createSigninScreen };
