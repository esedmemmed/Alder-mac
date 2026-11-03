/*
 * The sources page (port of StreamsActivity.kt, docs/sources.jpg). It finds the sources for one video and, normally, picks one:
 * it hands the player a short list to fall back on (the first TRY of the ranked sources) and replaces itself with the player,
 * so Back from the player lands on the title page, as Alder finishes the activity. With `pick` (held OK on Play, Settings'
 * "Show sources", or after three sources failed) it lists every playable source instead; OK on a row plays that source alone,
 * and Back from the player returns to this list.
 *
 *   router.push('streams', { type, id, videoId, name, episode?, pick?, resumeAt?, maxHeight?, message?, afterVideoId?,
 *                            poster?, background?, logo?, still?, runtime?, nextVideoId?, startOver? })
 *
 * The finding itself (household add-ons first, add-on order kept, an 800 ms wait for earlier add-ons, ranking) is
 * context.session.finder (core/finder.js + core/ranking.js). Rows: ranker.listModel's data; BEST MATCH, the quality,
 * summary, tags and provider columns, and Tizen's warnings: "No sound on this TV" and "May not play".
 */
import { h, clear } from '../lib/dom.js';
import { logoFor } from '../lib/images.js';
import { clock, artLayer, ring, keepVisible } from '../ui/screens-b/kit.js';
import { sourcesHeader, sourceCount, playerParams } from '../ui/screens-b/helpers.js';

const ROW = 80; // px: a 76 px row and its 4 px gap (ROW_H 38 dp: eight fit above the help line, as on the mock)

export function createStreamsScreen(params = {}) {
  let ctx = null;
  let session = null;
  let finder = null;
  let clockEl = null;
  let dead = false;
  let rowsEl = null;
  let clip = null;
  const scroll = { y: 0 };
  let rowEls = [];

  const head = sourcesHeader(params);

  function say(el, text) { clear(el); el.appendChild(h('div', { class: 'st-status t-body t-2 on-art' }, text)); }

  function play(streams, picked) {
    const p = playerParams(params, streams, { picked });
    if (picked) ctx.router.push('player', p); // Back from the player returns to this list
    else ctx.router.replace('player', p); // Back from the player returns to the title page
  }

  const scrollTo = (row) => keepVisible(clip, rowsEl, row, scroll, ROW);

  function streamRow(r) {
    const detail = h('div', { class: 'st-detail' });
    if (r.best) detail.appendChild(h('span', { class: 'st-best' }, 'BEST MATCH'));
    detail.appendChild(h('span', { class: 'st-summary ellipsis' + (r.best ? ' best' : '') }, r.summary));
    r.tags.forEach((t) => detail.appendChild(h('span', { class: 'st-tag' }, t.toUpperCase())));
    r.warnings.forEach((w) => detail.appendChild(h('span', { class: 'st-tag st-warn' }, w)));
    detail.appendChild(h('span', { class: 'st-provider ellipsis' }, r.provider));
    const mute = r.warnings.length > 0;
    const row = h('div', { class: 'st-row' + (r.dim ? ' dim' : '') + (mute ? ' mute' : ''), 'data-focus': '', tabindex: '-1', role: 'button' },
      h('span', { class: 'st-q' }, r.quality), detail, h('span', { class: 'st-size' }, r.size));
    row.addEventListener('focus', () => scrollTo(row));
    row.addEventListener('click', () => play([r.stream], true));
    return row;
  }

  function showList(model) {
    if (dead) return;
    rowEls = [];
    clear(rowsEl);
    scroll.y = 0;
    rowsEl.style.transform = '';
    counter.textContent = sourceCount(model.count);
    if (model.rows.length === 0) {
      rowsEl.appendChild(h('div', { class: 'st-status t-body t-2 on-art' }, 'No playable sources found for this TV.'));
      return;
    }
    model.rows.forEach((r) => { const el = streamRow(r); rowEls.push(el); rowsEl.appendChild(el); });
    ctx.engine.focus(rowEls[0]);
  }

  let counter = null;

  return {
    mount(root, p, context) {
      ctx = context;
      session = context.session;
      root.classList.add('st-screen');
      const art = artLayer(ctx.images);
      root.appendChild(art.el);
      root.appendChild(h('div', { class: 'st-veil' }));
      clockEl = clock();

      const logo = h('img', { class: 'st-logo', alt: '' });
      const fallback = h('div', { class: 'st-brandname t-name on-art' }, params.name || '');
      ctx.images.load(logo, params.logo || logoFor(params.id), { urgent: true, onDone() { logo.classList.add('on'); fallback.style.display = 'none'; } });
      counter = h('div', { class: 'st-count t-small t-3 on-art' }, '');
      const header = h('div', { class: 'st-header' },
        h('div', { class: 'st-brand' }, fallback, logo),
        h('div', { class: 'st-info' },
          h('div', { class: 't-small bold t-2 on-art ellipsis' }, head.eyebrow),
          h('div', { class: 't-name on-art ellipsis st-title' }, head.title)),
        counter);
      const cols = h('div', { class: 'st-cols caps t-3' }, h('span', { class: 'st-q' }, 'Quality'), h('span', { class: 'st-grow' }, 'Release'), h('span', { class: 'st-size' }, 'Size'));
      rowsEl = h('div', { class: 'st-rows' });
      clip = h('div', { class: 'st-scroll' }, rowsEl);
      const preset = session.settings.presetName();
      const help = h('div', { class: 'st-help t-small t-2 on-art' }, h('span', { class: 'st-ok' }, 'OK'),
        h('span', { class: 'ellipsis' }, '  Play this source  ·  Best match follows your stream settings: ', h('b', { class: 'st-preset' }, preset), '.'));
      const message = params.message ? h('div', { class: 'st-message t-small' }, params.message) : null;
      root.appendChild(h('div', { class: 'st-panel' }, header, h('div', { class: 'st-rule' }), message, cols, clip, help));
      root.appendChild(clockEl.el);

      const still = params.still || null;
      const backArt = params.background || params.poster || null;
      art.set(still || backArt, { orElse: still ? backArt : null });

      // loading
      rowsEl.appendChild(h('div', { class: 'st-loading' }, ring(), h('div', { class: 'st-status t-body t-2 on-art' }, 'Finding sources…')));

      const pick = !!params.pick || session.settings.alwaysList();
      finder = session.finder({
        type: params.type || 'movie', id: params.id, videoId: params.videoId, pick, maxHeight: params.maxHeight || 0,
        onPlay: (streams) => { if (!dead) play(streams, false); },
        onList: showList,
        onStatus: (code) => {
          if (dead) return;
          clear(rowsEl);
          say(rowsEl, code === 'no-addons'
            ? 'No stream add-ons are connected. Add one in Stremio to find sources.'
            : "Couldn't load sources. Check your connection and try again.");
        },
      });
      finder.start();
    },

    unmount() {
      dead = true;
      if (finder) finder.cancel();
      if (clockEl) clockEl.stop();
    },

    onKey(evt) {
      // The list is one column: Left and Right stay put rather than hunting for something at the sides.
      if (evt.type === 'press' && (evt.action === 'left' || evt.action === 'right')) return true;
      return false;
    },
  };
}
