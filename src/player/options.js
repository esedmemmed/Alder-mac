/*
 * The Audio & subtitles panel (docs/tracks.jpg), a port of openOptions() and section() in PlayerActivity.kt: a panel
 * down the left over the picture with the audio tracks, the subtitles (Off first), the subtitle timing when an add-on file
 * is on, the Picture size (Fit / Fill, with the source's shape under the heading), and "Change stream" with the source playing. The chosen row has a tick; OK on another row switches to it there
 * and then; Back closes. The panel is near opaque (PLAN.md: no backdrop-filter on this TV), and the playing bar is
 * repeated small at the bottom right.
 *
 * createOptions({ host, engine }) -> { open(), close(), isOpen(), key(evt) -> handled, onClose, update(state, left) }
 */
import { h } from '../lib/dom.js';
import { iconEl } from '../ui/icons.js';
import { createBar, formatClock } from './bar.js';
import { audioRows, subtitleRows, TIMING_STEPS, timingLabel } from './tracks.js';
import { PICTURE, pictureHints } from './picture.js';

const DOT = '  ·  ';

export function createOptions({ host, engine }) {
  let open = false;
  let rows = []; // { id, el, check, name, run }
  let at = 0;
  let wantId = null;
  let root = null;
  let scroller = null;
  let list = null;
  let bar = null;
  let elapsed = null;
  let left = null;
  let offTracks = null;
  let offPicture = null;

  /** One section: a tungsten heading and its rows. [chosen]: the index of the row with the tick. */
  function section(into, heading, items, chosenIndex, pick, notes = []) {
    into.appendChild(h('div', { class: 'caps pl-opt-heading', style: { color: 'var(--tungsten)' } }, heading));
    notes.filter(Boolean).forEach((text) => into.appendChild(h('div', { class: 'pl-opt-sub t-small t-2' }, text)));
    items.forEach((item, i) => {
      const dim = item.playable === false;
      const name = h('span', { class: 'pl-opt-name' }, item.name);
      const tag = item.tag ? h('span', { class: 'pl-opt-tag t-small t-3' }, item.tag) : null;
      const check = iconEl('check', 32, { className: 'pl-opt-check' });
      check.style.visibility = i === chosenIndex ? 'visible' : 'hidden';
      const el = h('div', { class: 'pl-row' + (i === chosenIndex ? ' chosen' : '') + (dim ? ' dim' : ''), role: 'menuitem' }, name, tag || h('span', { class: 'pl-opt-tag' }), check);
      into.appendChild(el);
      rows.push({ id: heading + ':' + (item.id !== undefined ? item.id : i), el, run: () => pick(i, item) });
    });
  }

  function build() {
    const t = engine.tracks();
    const info = engine.titleInfo();
    rows = [];
    list = h('div', { class: 'pl-opt-list' });
    list.appendChild(h('div', { class: 'pl-opt-title t-title' }, 'Audio & subtitles'));
    list.appendChild(h('div', { class: 'pl-opt-sub t-small t-2 ellipsis' }, [info.title, info.subtitle].filter(Boolean).join(DOT)));

    const audio = audioRows(t.audio);
    if (audio.length) {
      audio.forEach((r) => { r.id = r.index; });
      section(list, 'Audio', audio, audio.findIndex((r) => r.index === t.audioIndex), (i, r) => { engine.selectAudio(r.index); });
    }

    const subs = subtitleRows(t.text, t.addonSubs);
    subs.forEach((r) => { r.id = r.kind === 'off' ? 'off' : r.kind === 'file' ? 'file' + r.index : 'addon' + r.addonIndex; });
    let chosen = 0;
    if (t.subMode === 'file') chosen = Math.max(0, subs.findIndex((r) => r.kind === 'file' && r.index === t.textIndex));
    else if (t.subMode === 'addon') chosen = Math.max(0, subs.findIndex((r) => r.kind === 'addon' && r.sub === t.chosenSub));
    section(list, 'Subtitles', subs, chosen, (i, r) => {
      if (r.kind === 'off') engine.selectSubtitle({ kind: 'off' });
      else if (r.kind === 'file') engine.selectSubtitle({ kind: 'file', index: r.index });
      else engine.selectSubtitle({ kind: 'addon', sub: r.sub });
    });

    // Picture: Fit or Fill, with what the file says about its own shape (so black bars can be told from a small picture)
    const pic = engine.pictureInfo();
    if (pic.fillSupported) {
      const hints = pictureHints(pic.shape, true);
      const fillTag = pic.mode === PICTURE.FILL && pic.showing !== PICTURE.FILL && pic.reason ? pic.reason : hints.fill;
      const modes = [{ id: PICTURE.FIT, name: 'Fit', tag: hints.fit }, { id: PICTURE.FILL, name: 'Fill', tag: fillTag }];
      const note = pic.shape ? pic.text + (pic.bars ? '  ·  black bars are part of the film' : '') : "This file doesn't say its size";
      section(list, 'Picture', modes, pic.mode === PICTURE.FILL ? 1 : 0, (i, r) => { engine.setPicture(r.id); }, [note]);
    }

    if (t.canShift) {
      const steps = TIMING_STEPS.map((ms) => ({ name: timingLabel(ms), tag: '', id: ms, ms }));
      section(list, 'Subtitle timing', steps, TIMING_STEPS.indexOf(t.subDelay), (i, r) => { engine.setSubtitleDelay(r.ms); });
    }

    list.appendChild(h('div', { class: 'pl-opt-rule' }));
    const source = engine.currentSource();
    const label = source && source.label ? source.label.split(DOT.trim()).map((s) => s.trim()).filter(Boolean) : [];
    const shown = label.slice(1).concat(label.slice(0, 1)).join(DOT);
    const stream = h('div', { class: 'pl-row pl-stream', role: 'menuitem' },
      h('div', { class: 'bold' }, 'Change stream  →'), shown ? h('div', { class: 't-small t-3' }, shown) : null);
    list.appendChild(stream);
    rows.push({ id: 'stream', el: stream, run: () => engine.changeStream() });
  }

  function render() {
    build();
    scroller.innerHTML = '';
    scroller.appendChild(list);
    // The list is rebuilt after a pick (a tick moves, the Picture rows change their words): keep it where it was scrolled to,
    // or the row just chosen would jump out of view.
    if (scrollY) list.style.transform = 'translate3d(0,' + (-scrollY) + 'px,0)';
    let index = rows.findIndex((r) => r.id === wantId);
    if (index < 0) index = Math.min(at, rows.length - 1);
    focusRow(Math.max(0, index));
  }

  function focusRow(i) {
    at = Math.max(0, Math.min(rows.length - 1, i));
    wantId = rows[at] ? rows[at].id : null;
    rows.forEach((r, k) => r.el.classList.toggle('focus', k === at));
    // keep the focused row in view: the list slides under the panel's top edge (a ScrollView in Alder)
    const row = rows[at] && rows[at].el;
    if (!row) return;
    const view = scroller.clientHeight;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    const current = scrollY;
    let next = current;
    if (top - 24 < current) next = Math.max(0, top - 24);
    else if (bottom + 24 > current + view) next = bottom + 24 - view;
    if (at === 0 || at === 1) next = 0;
    if (next !== current) { scrollY = next; list.style.transform = 'translate3d(0,' + (-next) + 'px,0)'; }
  }
  let scrollY = 0;

  const api = {
    onClose: null,
    isOpen: () => open,
    open() {
      if (open) return;
      open = true;
      scrollY = 0;
      root = h('div', { class: 'pl-options' });
      scroller = h('div', { class: 'pl-opt-scroll' });
      bar = createBar(560);
      bar.el.classList.add('pl-opt-bar');
      elapsed = h('div', { class: 'pl-opt-elapsed t-small t-2 on-art' });
      left = h('div', { class: 'pl-opt-left t-small t-2 on-art' });
      root.appendChild(h('div', { class: 'pl-opt-panel' }, scroller));
      root.appendChild(bar.el); root.appendChild(elapsed); root.appendChild(left);
      host.appendChild(root);
      offTracks = engine.on('tracks', () => { if (open) render(); });
      offPicture = engine.on('picture', () => { if (open) render(); });
      // Alder focuses the first row of the Subtitles section ("subsFirst"): the picture's words are what people come for.
      wantId = 'Subtitles:off';
      render();
      api.update(engine.snapshot(), '');
    },
    /** [silent]: close without the controls coming back (Up next took the screen). */
    close(silent) {
      if (!open) return;
      open = false;
      if (offTracks) offTracks();
      if (offPicture) offPicture();
      if (root && root.parentNode) root.parentNode.removeChild(root);
      root = null;
      if (!silent && api.onClose) api.onClose();
    },
    update(s, leftText) {
      if (!open) return;
      bar.set(s.position, s.position, s.live ? 0 : s.duration);
      elapsed.textContent = s.live ? 'Live' : formatClock(s.position);
      left.textContent = s.live ? '' : leftText;
    },
    key(evt) {
      const press = evt.type === 'press' || (evt.type === 'hold' && evt.action === 'ok');
      if (!press) return true;
      const a = evt.action;
      if (a === 'back') { if (!evt.repeat) api.close(); return true; }
      if (a === 'up') focusRow(at - 1);
      else if (a === 'down') focusRow(at + 1);
      else if (a === 'ok' && !evt.repeat && rows[at]) rows[at].run();
      return true;
    },
  };
  return api;
}
