/*
 * The add-ons manager (port of AddonsActivity.kt): the account's add-ons in the order Stremio keeps them (the first that has
 * something answers first), with the role of each. OK on one moves it up or down or removes it (Cinemeta and the other
 * protected add-ons can only be moved); OK on "Add by URL" opens the TV keyboard for a manifest address. Every change saves to
 * Stremio at once and applies on all the account's devices. Stream add-on sharing between profiles is set in Settings, Streams.
 *
 *   router.push('addons', {})
 */
import { h, clear } from '../lib/dom.js';
import { Addon } from '../core/addon.js';
import { openPanel } from '../ui/panel.js';
import { keyHint, tag } from '../ui/chip.js';
import { clock, failedCard, ring, keepVisible, openTextDialog } from '../ui/screens-b/kit.js';
import { addonShortName, addonRole, addonHost, addonHelp, installUrl, isManifest, moved } from '../ui/screens-b/helpers.js';

const ADD_URL = 'add-url';
const ROW_H = 96;

export function createAddonsScreen() {
  let ctx = null;
  let session = null;
  let clockEl = null;
  let dead = false;
  let list = null;
  let clip = null;
  let help = null;
  let helpName = null;
  let helpBody = null;
  let addons = [];
  const scroll = { y: 0 };

  const key = () => session.authKey();

  /** Redraws the list, focusing [focus] (an add-on's URL), or its first row. */
  function show({ focus = null, message = null, retry = null, loading = false } = {}) {
    clear(list);
    scroll.y = 0;
    list.style.transform = '';
    list.appendChild(h('div', { class: 't-title serif on-art ad-title' }, 'My add-ons'));
    list.appendChild(h('div', { class: 't-small t-2 on-art ad-guide' }, 'The first add-on that has something answers first. ', h('span', { class: 'ad-apply' }, 'Changes apply to Stremio on all your devices.')));
    if (loading) list.appendChild(h('div', { class: 'ad-loading' }, ring()));
    let retryCard = null;
    if (message && retry) {
      retryCard = failedCard(message, retry);
      list.appendChild(h('div', { class: 'ad-failed' }, retryCard));
      if (!addons.length) { ctx.engine.focus(retryCard.querySelector('.pill')); return; }
    } else if (message) list.appendChild(h('div', { class: 't-small on-art ad-message' }, message));
    if (!loading && !addons.length && !message) list.appendChild(h('div', { class: 't-body t-2 on-art ad-empty' }, 'No add-ons yet. Add them in the Stremio app, then reload here.'));
    let target = null;
    addons.forEach((addon, index) => {
      const row = makeRow(index, addon);
      list.appendChild(row);
      if (addon.transportUrl === focus || (focus === null && target === null)) target = row;
    });
    const add = makeRow(addons.length, null);
    add.classList.add('add');
    list.appendChild(add);
    if (focus === ADD_URL || target === null) target = add;
    if (!loading) ctx.engine.focus(target);
  }

  function makeRow(index, addon) {
    const name = addon ? addonShortName(addon.name) : 'Add by URL';
    const role = addon ? addonRole(addon) : 'Install from a manifest address';
    const host = addon ? addonHost(addon) : '';
    const row = h('div', { class: 'ad-row', 'data-focus': '', tabindex: '-1', role: 'button', 'data-url': addon ? addon.transportUrl : ADD_URL },
      h('span', { class: 'ad-n t-small t-3' }, addon ? String(index + 1) : '+'),
      h('span', { class: 'ad-names' }, h('span', { class: 'ad-name ellipsis bold' }, name), h('span', { class: 'ad-role ellipsis t-small t-3' }, role)),
      host ? tag(host) : null,
      addon ? h('span', { class: 'ad-move' }, keyHint('OK', 'Move')) : null);
    row.setAttribute('aria-label', addon ? (index + 1) + '. ' + name + '. ' + role + '. ' + host + '. Move or remove' : name);
    row.addEventListener('focus', () => {
      keepVisible(clip, list, row, scroll);
      if (addon) { help.classList.add('on'); helpName.textContent = name.toUpperCase(); helpBody.textContent = addonHelp(addon, index); }
      else help.classList.remove('on');
    });
    row.addEventListener('click', () => { if (addon) edit(addon); else askUrl(); });
    return row;
  }

  function edit(a) {
    const i = addons.indexOf(a);
    const actions = [];
    if (i > 0) actions.push(['Move up', () => save(moved(addons, i, i - 1), a.transportUrl)]);
    if (i < addons.length - 1) actions.push(['Move down', () => save(moved(addons, i, i + 1), a.transportUrl)]);
    if (!a.locked) {
      actions.push(['Remove', () => openPanel(ctx, {
        title: 'Remove ' + addonShortName(a.name) + '?', items: ['Cancel', 'Remove'], focus: 0, message: 'This changes Stremio on all your devices.',
        onPick: (n) => { if (n === 1) save(addons.filter((x) => x !== a), addons[i + 1] ? addons[i + 1].transportUrl : null); },
      })]);
    }
    if (actions.length) openPanel(ctx, { title: addonShortName(a.name), items: actions.map((x) => x[0]), focus: 0, onPick: (n) => actions[n][1]() });
  }

  function askUrl() {
    openTextDialog(ctx, { title: 'Add an add-on', placeholder: 'https://…/manifest.json', confirm: 'Add', onSubmit: install, onClose: () => {} });
  }

  // Stremio's install links are stremio://host/…/manifest.json; a bare add-on address gets /manifest.json added.
  function install(typed) {
    const url = installUrl(typed);
    if (!url) { show({ focus: ADD_URL }); return; }
    if (addons.some((a) => a.transportUrl === url)) { show({ focus: url, message: 'Already installed.' }); return; }
    list.appendChild(h('div', { class: 'ad-loading' }, ring()));
    session.http.get(url, { timeoutMs: 15000 }).then((body) => {
      const manifest = JSON.parse(body);
      if (!isManifest(manifest)) throw new Error("That address isn't a Stremio addon.");
      return new Addon({ transportUrl: url, manifest, flags: { official: false, protected: false } }, { http: session.http });
    }).then((addon) => { if (!dead) save(addons.concat([addon]), url); },
      () => { if (!dead) show({ focus: ADD_URL, message: "Couldn't add the add-on. Check its address and try again." }); });
  }

  function save(next, focus) {
    const authKey = key();
    if (!authKey) return;
    session.stremio.setAddons(authKey, next).then(() => {
      if (dead) return;
      addons = next;
      show({ focus });
      session.addons({ refresh: true }).catch(() => {}); // keeps the new order for the next screen that asks (kept answers are what Home and Search read first)
    }, () => { if (!dead) show({ focus, message: "Couldn't save the change to Stremio.", retry: () => save(next, focus) }); });
  }

  function loadAddons(haveKept) {
    if (!haveKept) show({ loading: true });
    session.addons({ refresh: true }).then((fresh) => {
      if (dead) return;
      const same = haveKept && fresh.length === addons.length && fresh.every((a, i) => a.transportUrl === addons[i].transportUrl);
      addons = fresh;
      if (!same) {
        const at = ctx.engine.current();
        show({ focus: at && at.getAttribute('data-url') });
      }
    }, () => { if (!dead && !haveKept) show({ message: "Couldn't reach Stremio. Check the TV's internet.", retry: () => loadAddons(false) }); });
  }

  return {
    mount(root, p, context) {
      ctx = context;
      session = context.session;
      root.classList.add('ad-screen');
      clockEl = clock();
      list = h('div', { class: 'ad-list' });
      clip = h('div', { class: 'ad-clip' }, list);
      helpName = h('div', { class: 'caps ad-help-name on-art' });
      helpBody = h('div', { class: 't-body t-2 on-art ad-help-body' });
      help = h('div', { class: 'ad-help' }, helpName, helpBody);
      root.appendChild(h('div', { class: 'ad-panel' }, clip, h('div', { class: 'ad-footer' }, keyHint('OK', 'Move or remove'))));
      root.appendChild(help);
      root.appendChild(clockEl.el);
      if (!key()) return;
      // What is kept from last time first, then Stremio's own answer (Alder asks Stremio each time this page opens).
      const kept = session.savedAddons();
      if (kept) { addons = kept; show({}); }
      loadAddons(kept !== null);
    },

    unmount() { dead = true; if (clockEl) clockEl.stop(); },

    onKey(evt) {
      if (evt.type === 'press' && (evt.action === 'left' || evt.action === 'right')) return true;
      return false;
    },
  };
}
