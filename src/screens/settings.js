/*
 * Settings (port of SettingsActivity.kt, docs/settings.jpg): groups at the left (Streams, Picture & Sound, Subtitles, Add-ons,
 * Profile, Language, Storage, About), the group's rows at the right and a line of help that follows the focused row. Left and
 * Right on a choice step through its values (OK steps forward); "Source choice" steps through the presets. The choices live in
 * core/settings.js (the same keys and defaults as Alder); taste (release type, dubs, audio language) is per profile.
 *
 * Dropped for Tizen (PLAN.md section 1): Match frame rate, Audio output (receiver passthrough) and Updates. Added: "My TV plays
 * AV1" (Advanced, off), and in About a Diagnostics row (hold OK on the version works too).
 *
 *   router.push('settings', {})
 */
import { h, clear } from '../lib/dom.js';
import { VERSION } from '../lib/env.js';
import { languageName } from '../core/lang.js';
import { STREAMING, PICTURE_AND_SOUND, SUBTITLES, ADVANCED, PRESET_HINT } from '../core/settings.js';
import { fillOffered } from '../player/avplay.js';
import { iconSvg } from '../ui/icons.js';
import { openPanel } from '../ui/panel.js';
import { createTvLanguage } from '../player/language.js';
import { openDiagnostics } from './diagnostics.js';
import { clock, avatar, keepVisible } from '../ui/screens-b/kit.js';
import { addonShortName } from '../ui/screens-b/helpers.js';

// Icons Alder draws as glyphs (♙ ◎ ▤): drawn here, the bundled fonts have no such characters.
// Same attributes as src/ui/icons.js gives its icons (xmlns, numeric size, viewBox): an <svg> with only a viewBox collapses on the TV.
const svg = (inner) => '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" focusable="false" aria-hidden="true">' + inner + '</svg>';
const PERSON = svg('<path d="M12,12c2.21,0 4,-1.79 4,-4s-1.79,-4 -4,-4 -4,1.79 -4,4 1.79,4 4,4zM12,14c-2.67,0 -8,1.34 -8,4v2h16v-2c0,-2.66 -5.33,-4 -8,-4z"/>');
const GLOBE = svg('<path d="M12,3a9,9 0,1 0,0 18a9,9 0,0 0,0 -18zM12,5a7,7 0,1 1,0 14a7,7 0,0 1,0 -14z"/><circle cx="12" cy="12" r="3.2"/>');
const DRIVE = svg('<path d="M4,5h16a2,2 0,0 1,2 2v10a2,2 0,0 1,-2 2H4a2,2 0,0 1,-2 -2V7a2,2 0,0 1,2 -2zM4,7v10h16V7zM6,9h12v2H6zM6,13h12v2H6z"/>');

const GROUPS = [
  { id: 'streams', label: 'Streams', icon: iconSvg('play'), hint: 'Choose how Alder finds and starts a source.' },
  { id: 'picture', label: 'Picture & Sound', icon: iconSvg('tv'), hint: 'Choose the picture and sound this TV can play.' },
  { id: 'subtitles', label: 'Subtitles', icon: iconSvg('subtitles'), hint: 'Set how subtitles start and appear.' },
  { id: 'addons', label: 'Add-ons', icon: iconSvg('layers'), hint: 'Manage the add-ons connected to this profile.' },
  { id: 'profile', label: 'Profile', icon: PERSON, hint: 'Profile choices stay with the person watching.' },
  { id: 'language', label: 'Language', icon: GLOBE, hint: "Alder follows the TV's language." },
  { id: 'storage', label: 'Storage', icon: DRIVE, hint: 'Storage on this TV only.', quiet: true, rule: true },
  { id: 'about', label: 'About', icon: iconSvg('info'), hint: 'About Alder.', quiet: true },
];

export function createSettingsScreen() {
  let ctx = null;
  let session = null;
  let root = null;
  let clockEl = null;
  let dead = false;
  let groupEls = new Map();
  let rowsEl = null;
  let clip = null;
  let hintEl = null;
  let nameEl = null;
  let avatarEl = null;
  let selected = null;
  let rows = []; // the detail rows: { el, shift?(by), refresh?() }
  let refreshers = [];
  let addonValue = null;
  const scroll = { y: 0 };
  const tvLang = createTvLanguage({ log: null });

  const settings = () => session.settings;

  // ---------- rows ----------

  /** A row: label (and "THIS PROFILE"), the value at the right, help in the line under the rows. */
  function settingRow({ label, value, help, perProfile = false, onClick = null, onFocus = null, onBlur = null, onHold = null }) {
    const el = h('div', { class: 'sg-row', 'data-focus': '', tabindex: '-1', role: 'button' },
      h('span', { class: 'sg-label' }, label),
      perProfile ? h('span', { class: 'sg-tag' }, 'THIS PROFILE') : null,
      h('span', { class: 'sg-spacer' }), value);
    el.addEventListener('focus', () => { hintEl.textContent = help; keep(el); if (onFocus) onFocus(); });
    el.addEventListener('blur', () => { if (onBlur) onBlur(); });
    if (onClick) el.addEventListener('click', onClick);
    if (onHold) el.addEventListener('alder:hold', onHold);
    const row = { el };
    rows.push(row);
    rowsEl.appendChild(el);
    return row;
  }

  const keep = (el) => keepVisible(clip, rowsEl, el, scroll);

  function actionRow(label, valueText, help, onClick, opts = {}) {
    const value = h('span', { class: 'sg-value' }, valueText ? valueText + '  ›' : '›');
    const row = settingRow(Object.assign({ label, value, help, onClick, onFocus: () => value.classList.add('on'), onBlur: () => value.classList.remove('on') }, opts));
    row.value = value;
    row.setValue = (text) => { value.textContent = text; };
    return row;
  }

  function choiceRow(c) {
    const values = c.values;
    const current = () => { const stored = settings().stored(c); return Math.max(0, values.findIndex((v) => v[0] === stored)); };
    // A switch only where the choice is On or Off; "Best source / Show sources" is a choice with words.
    const isSwitch = values.map((v) => v[1]).join('|') === 'On|Off';
    const words = h('span', { class: 'sg-words' });
    const knob = h('i');
    const track = h('span', { class: 'sg-track' }, knob);
    const value = isSwitch ? h('span', { class: 'sg-value sg-switch' }, words, track) : h('span', { class: 'sg-value' }, words);
    let focused = false;
    const draw = () => {
      const v = values[current()];
      words.textContent = isSwitch ? v[1] : (focused ? '‹  ' + v[1] + '  ›' : v[1]);
      value.classList.toggle('on', focused);
      track.classList.toggle('on', isSwitch && v[0] === true);
    };
    const shift = (by) => { settings().shift(c, by); refreshers.forEach((f) => f()); };
    const row = settingRow({ label: c.label, value, help: c.hint, perProfile: c.perProfile, onClick: () => shift(1), onFocus: () => { focused = true; draw(); }, onBlur: () => { focused = false; draw(); } });
    row.shift = shift;
    refreshers.push(draw);
    draw();
    return row;
  }

  function presetRow() {
    const words = h('span', { class: 'sg-words' });
    const value = h('span', { class: 'sg-value' }, words);
    let focused = false;
    const draw = () => { words.textContent = (focused ? '‹  ' : '') + settings().presetName() + (focused ? '  ›' : ''); value.classList.toggle('on', focused); };
    const shift = (by) => { settings().shiftPreset(by); refreshers.forEach((f) => f()); };
    const row = settingRow({ label: 'Source choice', value, help: PRESET_HINT, onClick: () => shift(1), onFocus: () => { focused = true; draw(); }, onBlur: () => { focused = false; draw(); } });
    row.shift = shift;
    refreshers.push(draw);
    draw();
    return row;
  }

  function note(text) { rowsEl.appendChild(h('div', { class: 'sg-sub caps t-3' }, text)); }

  // ---------- groups ----------

  function addonCount() {
    session.addons().then((list) => { if (!dead && addonValue) addonValue.setValue(list.length + ' installed  ›'); }, () => { if (!dead && addonValue) addonValue.setValue('Unavailable  ›'); });
  }

  function showGroup(group, force = false) {
    if (selected === group && rows.length && !force) return;
    selected = group;
    groupEls.forEach((el, g) => { el.classList.toggle('on', g === group.id); });
    clear(rowsEl);
    rows = [];
    refreshers = [];
    addonValue = null;
    scroll.y = 0;
    rowsEl.style.transform = '';
    detailTitle.textContent = group.label;
    hintEl.textContent = group.hint;

    switch (group.id) {
      case 'streams': {
        presetRow();
        STREAMING.forEach(choiceRow);
        const me = session.profile();
        if (me) {
          const share = actionRow('Share my streaming sources', session.profiles.sharesStreams(me.id) ? 'On' : 'Off',
            "Other profiles on this TV can find sources with this profile's stream add-ons. Your add-on's provider may see what they play.",
            () => {
              const on = !session.profiles.sharesStreams(me.id);
              session.profiles.setSharesStreams(me.id, on);
              share.setValue((on ? 'On' : 'Off') + '  ›');
            });
        }
        session.profiles.streamLenders().forEach((lender) => {
          const row = actionRow('Shared by ' + lender.name, '…', lender.name + ' shares these stream add-ons with every profile on this TV. Your history stays yours.', () => {});
          Promise.resolve().then(() => session.stremio.savedAddons(lender.authKey) || session.stremio.addons(lender.authKey)).then((list) => {
            if (dead || selected !== group) return;
            const names = list.filter((a) => a.shareable).map((a) => addonShortName(a.name));
            row.setValue((names.length ? names.join(', ') : 'No stream add-ons') + '  ›');
          }, () => { if (!dead && selected === group) row.setValue("Couldn't load  ›"); });
        });
        actionRow('More filters', '', 'Release groups, codecs and more are set in your streaming add-on.', () => {
          openPanel(ctx, { title: 'More filters', items: ['OK'], focus: 0, message: 'Release groups, codecs, languages and more are set in your streaming add-on on your phone or at web.stremio.com. This TV follows its order.' });
        });
        break;
      }
      case 'picture':
        // Picture size is a choice between Fit and Fill; with Fill not offered (docs/DECISIONS.md) there is nothing to choose
        PICTURE_AND_SOUND.filter((c) => c.key !== 'pictureSize' || fillOffered()).forEach(choiceRow);
        note('Advanced');
        ADVANCED.forEach(choiceRow);
        break;
      case 'subtitles':
        SUBTITLES.forEach(choiceRow);
        break;
      case 'addons': {
        addonValue = actionRow('My add-ons', '…', "Add by URL, reorder or remove this profile's add-ons.", () => { if (session.authKey()) ctx.router.push('addons', {}); });
        actionRow('Reload add-ons from Stremio', '', "Fetch this profile's add-ons after installing some elsewhere.", () => {
          addonValue.setValue('Reloading…');
          session.addons({ refresh: true }).then((list) => { if (!dead && addonValue) addonValue.setValue(list.length + ' installed  ›'); }, () => { if (!dead && addonValue) addonValue.setValue('Reload failed  ›'); });
        });
        addonCount();
        break;
      }
      case 'profile':
        actionRow('Switch profile', '', 'Choose who is watching.', () => ctx.router.reset('profiles', {}));
        actionRow('Manage profiles', '', 'Rename profiles, change PINs or add another person.', () => ctx.router.reset('profiles', {}));
        break;
      case 'language':
        actionRow('App language', languageName(tvLang.get()), "The app follows this TV's language setting.", () => {
          openPanel(ctx, { title: 'App language', items: ['OK'], focus: 0, message: "Alder follows this TV's language. Change it in the TV's own settings." });
        });
        break;
      case 'storage':
        actionRow('Clear local storage', '', 'Removes profiles, settings and saved data from this TV. Stremio accounts stay as they are.', () => {
          openPanel(ctx, {
            title: 'Clear local storage?', items: ['Cancel', 'Clear'], focus: 0,
            message: 'This removes saved profiles, settings and cached data from this TV. It does not cancel your Stremio account.',
            onPick: (i) => {
              if (i !== 1) return;
              session.store.clear();
              if (session.http && session.http.forget) session.http.forget();
              window.location.reload(); // the app starts again with nothing kept
            },
          });
        });
        break;
      case 'about': {
        rowsEl.appendChild(h('div', { class: 'sg-brand' }, h('span', { class: 'sg-mark' }), h('span', { class: 'serif sg-wordmark' }, 'Alder')));
        const version = actionRow('Alder', 'Version ' + VERSION, 'Alder is a TV interface for your Stremio account.', () => {
          openPanel(ctx, { title: 'Alder', items: ['OK'], focus: 0, message: 'A TV interface for your Stremio account. Hold OK on the version for Diagnostics.' });
        }, { onHold: () => openDiagnostics(ctx) });
        version.el.setAttribute('data-version', '');
        actionRow('Diagnostics', '', 'What happened and what this TV reported: the log, the device and the last stream. Photograph it when something does not play.', () => openDiagnostics(ctx));
        actionRow('Based on Alder', 'GPL-3.0', 'Alder for Tizen is a port of Alder, the Android TV Stremio client by aradhyas8 (github.com/aradhyas8/Alder), under the GNU GPL v3.', () => {
          openPanel(ctx, { title: 'Based on Alder', items: ['OK'], focus: 0, message: 'Alder for Tizen is a port of Alder, the Android TV Stremio client, released under the GNU General Public License v3.' });
        });
        break;
      }
      default:
    }
  }

  let detailTitle = null;

  function refreshHeader() {
    const p = session.profile();
    nameEl.textContent = p ? 'Profile ' + p.name : '';
    avatarEl.textContent = p && p.name ? p.name.charAt(0).toUpperCase() : 'A';
  }

  return {
    mount(el, p, context) {
      ctx = context;
      session = context.session;
      root = el;
      el.classList.add('sg-screen');
      clockEl = clock();

      avatarEl = h('div', { class: 'avatar sg-avatar' }, 'A');
      nameEl = h('div', { class: 'sg-profile t-small t-3' });
      el.appendChild(h('div', { class: 'sg-header' }, avatarEl, h('div', { class: 't-title sg-title' }, 'Settings'), nameEl));
      el.appendChild(clockEl.el);

      const list = h('div', { class: 'sg-groups' });
      GROUPS.forEach((g) => {
        if (g.rule) list.appendChild(h('div', { class: 'sg-rule' }));
        const row = h('div', { class: 'sg-group' + (g.quiet ? ' quiet' : ''), 'data-focus': '', tabindex: '-1', role: 'button', 'data-group': g.id },
          h('span', { class: 'sg-dot' }, '•'), h('span', { class: 'icon sg-icon', html: g.icon }), h('span', { class: 'sg-gl' }, g.label));
        row.addEventListener('focus', () => showGroup(g));
        row.addEventListener('click', () => { showGroup(g); if (rows[0]) ctx.engine.focus(rows[0].el); });
        groupEls.set(g.id, row);
        list.appendChild(row);
      });
      el.appendChild(list);

      detailTitle = h('div', { class: 'sg-detail-title bold' });
      rowsEl = h('div', { class: 'sg-rows' });
      clip = h('div', { class: 'sg-clip' }, rowsEl);
      hintEl = h('div', { class: 'sg-hint t-small t-2 on-art' });
      el.appendChild(h('div', { class: 'sg-detail' }, detailTitle, clip, hintEl));

      refreshHeader();
      showGroup(GROUPS[0]);
      ctx.engine.focus(groupEls.get('streams'));
    },

    unmount() { dead = true; if (clockEl) clockEl.stop(); },

    /** Back from Add-ons: the count, the profile and every value may have changed. */
    resume() {
      refreshHeader();
      refreshers.forEach((f) => f());
      if (selected && selected.id === 'addons') addonCount();
    },

    onKey(evt) {
      if (evt.type !== 'press') return false;
      const a = evt.action;
      const focus = ctx.engine.current();
      if (!focus) return false;
      const inGroups = focus.hasAttribute('data-group');
      const at = rows.findIndex((r) => r.el === focus);
      if (inGroups) {
        if (a === 'right') { if (rows[0]) ctx.engine.focus(rows[0].el); return true; }
        if (a === 'left') return true;
        return false;
      }
      if (at >= 0) {
        const row = rows[at];
        if ((a === 'left' || a === 'right') && row.shift) { row.shift(a === 'left' ? -1 : 1); return true; }
        if (a === 'left' || (a === 'back' && !evt.repeat)) { ctx.engine.focus(groupEls.get(selected.id)); return true; }
        if (a === 'right') return true;
        if (a === 'down' && at === rows.length - 1) return true; // the rows end where they end
      }
      return false;
    },
  };
}
