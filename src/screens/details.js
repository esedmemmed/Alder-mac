/*
 * The title page (port of DetailsActivity.kt, docs/title.png): the title's art fills the screen, its logo (or name), facts and
 * description sit bottom left over a shade, then where you are, Play / Resume, Start over, My List and More information.
 * Down opens the episode guide (a series) or "More like this" (a movie, when an add-on offers it). Play opens the sources
 * page (`streams`), which starts playback itself; held OK on Play (or on an episode) lists every source to pick by hand.
 *
 *   router.push('details', { type, id, name?, poster?, background?, logo? })
 *
 * Reads context.session (meta, library, books). Keys: Down from the buttons opens the guide, Up in "More like this" closes it,
 * Back closes the guide, the story or "More like this", then leaves.
 */
import { h, clear } from '../lib/dom.js';
import { logoFor } from '../lib/images.js';
import { runtime } from '../core/addon.js';
import { createRow } from '../ui/row.js';
import { progressBar } from '../ui/card.js';
import { pill } from '../ui/button.js';
import { chip } from '../ui/chip.js';
import { clock, shades, artLayer, failedCard, glyphButton, keepVisible, REPLAY_SVG, imdbTag, icon } from '../ui/screens-b/kit.js';
import { DOT, episodeDate, episodeLabel, seasonLabel, minutesLeft, seasonsText, playTarget } from '../ui/screens-b/helpers.js';

const STARTED = 60000; // ms watched before a title counts as started: a title opened and closed at 0:00 offers Play, not Resume

export function createDetailsScreen(params = {}) {
  const type = params.type || 'movie';
  const metaId = params.id;
  let ctx = null;
  let session = null;
  let root = null;
  let art = null;
  let clockEl = null;
  let hero = null;
  let guide = null;
  let info = null;
  let similar = null;
  let guideOpen = false;
  let infoOpen = false;
  let similarOpen = false;
  let dead = false;

  let meta = null;
  let item = null; // the title's library item: progress, and whether it is in My List
  let itemChangedHere = false;
  let similarRequested = false;
  let similarTitles = null;
  let similarRow = null;
  let selectedSeason = 1;
  let episodeRows = [];
  let seasonChips = new Map();
  let listButton = null;
  let playButton = null;
  let infoButton = null;

  const books = () => session.books;
  const initialArt = params.background || params.poster || null;

  // ---------- loading ----------

  function show(m) {
    meta = m;
    art.set(m.background || initialArt, { orElse: params.poster || null });
    showHero(m);
    if (type === 'series' && m.videos.length) buildGuide(m.videos);
    if (type === 'movie' && !similarRequested) { similarRequested = true; loadSimilar(); }
  }

  function load() {
    const saved = session.savedMeta(type, metaId);
    const kept = session.savedLibrary();
    if (kept && !itemChangedHere && !item) item = kept.find((it) => it._id === metaId) || null;
    if (saved) show(saved);
    session.meta(type, metaId).then((fresh) => {
      if (dead) return;
      if (fresh) show(fresh);
      else if (!meta) showHero(null);
    }, () => { if (!dead && !meta) showHero(null); });
    refreshItem(false);
  }

  function refreshItem(redraw = true) {
    session.library().then((list) => {
      if (dead || itemChangedHere) return;
      item = list.find((it) => it._id === metaId) || item;
      if (meta && redraw) redrawAll();
    }, () => {});
    session.library({ refresh: true }).then((list) => {
      if (dead || itemChangedHere) return;
      item = list.find((it) => it._id === metaId) || item;
      if (meta) redrawAll();
    }, () => {});
  }

  /** Back from the player: progress, the resume point and My List may have changed. */
  function redrawAll() {
    if (!meta) return;
    const wasGuide = guideOpen;
    if (infoOpen) closeInfo(false);
    showHero(meta);
    if (type === 'series' && meta.videos.length) { buildGuide(meta.videos); if (wasGuide) openGuide(false); }
  }

  // ---------- title and watch window ----------

  function showHero(m) {
    // Focus kept from before is only focus on this page: arriving from Home, the engine still points at the card below.
    const current = ctx.engine.current();
    const keep = current && root.contains(current) ? current : null;
    const hadFocus = keep && hero && hero.contains(keep);
    if (!hero) {
      hero = h('div', { class: 'dt-hero' });
      root.appendChild(hero);
    }
    clear(hero);
    const name = h('div', { class: 'dt-name t-hero on-art' + ((m ? m.name : params.name || '').length > 34 ? ' long' : '') }, m ? m.name : params.name || '');
    const logo = h('img', { class: 'dt-logo', alt: '' });
    const titleArea = h('div', { class: 'dt-title' }, name, m ? logo : null);
    if (m) {
      ctx.images.load(logo, m.logo || logoFor(m.id), {
        urgent: true,
        onDone() { name.style.display = 'none'; logo.classList.add('on'); },
        onFail() { name.style.display = ''; logo.classList.remove('on'); },
      });
    }
    const stack = h('div', { class: 'dt-stack' }, titleArea);
    if (!m) {
      const retry = failedCard("Couldn't load this title's details.", () => ctx.router.replace('details', params));
      stack.appendChild(retry);
    } else {
      const length = type === 'series'
        ? (n => (n > 0 ? seasonsText(n) : null))(new Set(m.videos.map((v) => v.season).filter((s) => s > 0)).size)
        : m.runtime;
      const facts = [m.year, m.genres[0], length].filter((x) => x).join(DOT);
      const factRow = h('div', { class: 'dt-facts on-art' }, h('span', { class: 'ellipsis' }, facts));
      if (m.rating) factRow.appendChild(h('span', { class: 'dt-dot' }, '·'));
      if (m.rating) factRow.appendChild(imdbTag());
      if (m.rating) factRow.appendChild(h('span', { class: 'dt-rating' }, m.rating));
      stack.appendChild(factRow);
      if (m.description && m.description.trim()) stack.appendChild(h('div', { class: 'dt-about t-body on-art' }, m.description));
      addWatch(m, stack);
    }
    hero.appendChild(stack);
    const hasEpisodes = type === 'series' && !!m && m.videos.length > 0;
    if (hasEpisodes || similarTitles) {
      const more = h('div', { class: 'dt-more caps on-art', 'data-focus': '', tabindex: '-1', role: 'button' }, hasEpisodes ? '▾  Episodes' : '▾  More like this');
      more.addEventListener('click', () => { if (hasEpisodes) openGuide(true); else openSimilar(); });
      hero.appendChild(more);
    }
    if (!guideOpen && !infoOpen && !similarOpen && (!keep || hadFocus || !keep.isConnected)) focusPlay();
  }

  const focusPlay = () => { if (playButton && playButton.isConnected) ctx.engine.focus(playButton); else ctx.engine.focusFirst(); };

  /** Where you are, then the main action and three small glass controls. */
  function addWatch(m, stack) {
    const target = playTarget(m, item, metaId);
    const episode = target.video;
    const resumeAt = ((item && books().resumeAt(item, target.videoId)) || 0) >= STARTED ? books().resumeAt(item, target.videoId) : 0;
    const duration = (item && item.state && item.state.duration) || 0;
    const remaining = resumeAt > 0 && duration > resumeAt ? runtime(Math.floor((duration - resumeAt) / 60000) + ' min') + ' left' : null;
    const where = [episode ? episodeLabel(episode) : null, episode && episode.title && episode.title.trim() ? episode.title : null, remaining].filter((x) => x).join(DOT);
    if (where && resumeAt > 0) stack.appendChild(h('div', { class: 'dt-where on-art ellipsis' }, where));
    if (remaining) stack.appendChild(h('div', { class: 'dt-resume' }, progressBar(resumeAt / duration)));

    playButton = pill(resumeAt > 0 ? 'Resume' : 'Play', {
      icon: 'play',
      onClick: () => openSources(target.videoId, { startOver: false }),
      onHold: () => openSources(target.videoId, { startOver: false, pick: true }), // held OK: every source, to choose one by hand
    });
    const buttons = h('div', { class: 'dt-buttons' }, playButton);
    if (resumeAt > 0) buttons.appendChild(glyphButton(REPLAY_SVG, { label: 'Start over', onClick: () => openSources(target.videoId, { startOver: true }) }));
    listButton = glyphButton(icon(books().inList(item) ? 'check' : 'add'), { label: 'My List', onClick: toggleList });
    infoButton = glyphButton(icon('info'), { label: 'More information', onClick: openInfo });
    buttons.appendChild(listButton);
    buttons.appendChild(infoButton);
    stack.appendChild(buttons);
  }

  function toggleList() {
    itemChangedHere = true;
    const entry = item || books().newItem(metaId, type, (meta && meta.name) || params.name || '', (meta && meta.poster) || params.poster || null);
    const on = !books().inList(item);
    books().setInList(entry, on);
    item = entry;
    listButton.firstChild.innerHTML = icon(books().inList(entry) ? 'check' : 'add');
    listButton.setAttribute('aria-label', books().inList(entry) ? 'Remove from My List' : 'Add to My List');
    ctx.toast(books().inList(entry) ? 'Added to My List' : 'Removed from My List');
    const snapshot = JSON.parse(JSON.stringify(entry));
    session.saveLibrary([snapshot]).catch((e) => ctx.log && ctx.log.warn('details', 'saving My List failed: ' + e.message));
  }

  // ---------- the episode guide ----------

  function buildGuide(videos) {
    if (guide) { if (guide.el.parentNode) guide.el.parentNode.removeChild(guide.el); }
    guideOpen = false;
    const small = h('img', { class: 'eg-logo', alt: '' });
    const fallback = h('div', { class: 'eg-name t-title on-art', style: { display: 'none' } }, (meta && meta.name) || params.name || '');
    ctx.images.load(small, (meta && meta.logo) || logoFor(metaId), { urgent: true, onDone() { small.classList.add('on'); }, onFail() { small.style.display = 'none'; fallback.style.display = ''; } });
    const strip = h('div', { class: 'eg-seasons' });
    const rows = h('div', { class: 'eg-rows' });
    const rowsClip = h('div', { class: 'eg-rows-clip' }, rows);
    const previewImage = h('img', { class: 'eg-still', alt: '' });
    const previewProgress = h('div', { class: 'eg-still-progress' });
    const previewTitle = h('div', { class: 'eg-ptitle serif on-art' });
    const previewFacts = h('div', { class: 'eg-pfacts t-small t-2 on-art' });
    const previewAbout = h('div', { class: 'eg-pabout t-small on-art' });
    const pane = h('div', { class: 'eg-pane' }, rowsClip, previewImage, previewProgress, previewTitle, previewFacts, previewAbout);
    const el = h('div', { class: 'eg', hidden: true }, small, fallback, strip, pane);
    root.appendChild(el);
    guide = { el, strip, rows, rowsClip, previewImage, previewProgress, previewTitle, previewFacts, previewAbout };
    selectedSeason = (playTarget(meta, item, metaId).video || videos[0]).season;
    fillGuide();
  }

  function fillGuide() {
    const videos = (meta && meta.videos) || [];
    const seasons = [];
    videos.forEach((v) => { if (seasons.indexOf(v.season) < 0) seasons.push(v.season); });
    clear(guide.strip);
    seasonChips = new Map();
    seasons.forEach((season) => {
      const c = chip(seasonLabel(season, season === selectedSeason), { selected: season === selectedSeason, onClick: () => { selectedSeason = season; fillGuide(); focusSeason(season); } });
      c.el.setAttribute('data-season', season);
      guide.strip.appendChild(c.el);
      seasonChips.set(season, c.el);
    });
    clear(guide.rows);
    listScroll.y = 0;
    guide.rows.style.transform = '';
    const watched = books().watched(item, videos);
    const currentId = playTarget(meta, item, metaId).videoId;
    episodeRows = videos.filter((v) => v.season === selectedSeason).map((video) => {
      const resumeAt = item ? books().resumeAt(item, video.id) : 0;
      const state = item && item.state && item.state.video_id === video.id ? item.state : null;
      const duration = (state && state.duration) || 0;
      const isWatched = watched.has(video.id);
      const left = minutesLeft(resumeAt, duration);
      const status = isWatched ? '✓' : left || (meta && meta.runtime) || '';
      const row = h('div', { class: 'eg-row', 'data-focus': '', tabindex: '-1', role: 'button', 'data-video': video.id },
        h('span', { class: 'eg-num t-3' }, String(video.episode).padStart(2, '0')),
        h('span', { class: 'eg-title ellipsis' + (isWatched ? ' t-2' : '') }, video.title && video.title.trim() ? video.title : 'Episode ' + video.episode),
        status ? h('span', { class: 'eg-status' + (isWatched ? ' done' : '') }, status) : null);
      row.addEventListener('focus', () => { updatePreview(video); scrollTo(row); });
      const next = () => { const i = videos.indexOf(video) + 1; return videos[i] ? videos[i].id : null; };
      row.addEventListener('click', () => openSources(video.id, { startOver: false, next: next(), label: episodeLabel(video) }));
      row.addEventListener('alder:hold', () => openSources(video.id, { startOver: false, next: next(), label: episodeLabel(video), pick: true }));
      guide.rows.appendChild(row);
      row._id = video.id;
      return row;
    });
    const first = videos.find((v) => v.id === currentId && v.season === selectedSeason) || videos.find((v) => v.season === selectedSeason);
    if (first) updatePreview(first);
  }

  function focusSeason(season) { const c = seasonChips.get(season); if (c) ctx.engine.focus(c); }

  const listScroll = { y: 0 };
  const scrollTo = (row) => keepVisible(guide.rowsClip, guide.rows, row, listScroll);

  function updatePreview(video) {
    const g = guide;
    ctx.images.load(g.previewImage, video.thumbnail, { orElse: meta && meta.background, onDone() { g.previewImage.classList.add('on'); } });
    g.previewTitle.textContent = video.title && video.title.trim() ? video.title : 'Episode ' + video.episode;
    g.previewFacts.textContent = [episodeLabel(video), meta && meta.runtime, episodeDate(video.released)].filter((x) => x).join(DOT);
    g.previewAbout.textContent = video.overview || '';
    g.previewAbout.style.display = video.overview && video.overview.trim() ? '' : 'none';
    clear(g.previewProgress);
    const state = item && item.state && item.state.video_id === video.id ? item.state : null;
    const resumeAt = item ? books().resumeAt(item, video.id) : 0;
    const duration = (state && state.duration) || 0;
    if (resumeAt > 0 && duration > resumeAt) g.previewProgress.appendChild(progressBar(resumeAt / duration));
  }

  function openGuide(animate) {
    if (!guide || guideOpen) return;
    guideOpen = true;
    hero.hidden = true;
    guide.el.hidden = false;
    if (animate) { guide.el.classList.remove('on'); void guide.el.offsetWidth; }
    guide.el.classList.add('on');
    art.dim(true); // the film steps back behind the guide
    root.classList.add('guide');
    const currentId = playTarget(meta, item, metaId).videoId;
    const row = episodeRows.find((r) => r._id === currentId) || episodeRows[0];
    if (row) ctx.engine.focus(row); else focusSeason(selectedSeason);
  }

  function closeGuide() {
    guideOpen = false;
    art.dim(false);
    root.classList.remove('guide');
    guide.el.classList.remove('on');
    guide.el.hidden = true;
    hero.hidden = false;
    focusPlay();
  }

  // ---------- the story (More information) ----------

  function openInfo() {
    if (!meta) return;
    if (info && info.parentNode) info.parentNode.removeChild(info);
    infoOpen = true;
    hero.hidden = true;
    const m = meta;
    const facts = [m.year, m.runtime, m.genres.slice(0, 2).join(' / ') || null, m.rating ? 'IMDb ' + m.rating : null].filter((x) => x).join(DOT);
    const story = h('div', { class: 'dt-story', 'data-focus': '', tabindex: '-1' });
    const inner = h('div', { class: 'dt-story-inner' });
    if (m.description && m.description.trim()) inner.appendChild(h('div', { class: 't-body on-art' }, m.description));
    if (m.cast.length) {
      inner.appendChild(h('div', { class: 'caps on-art dt-cast-h' }, 'Cast'));
      inner.appendChild(h('div', { class: 't-body on-art dt-cast' }, m.cast.slice(0, 12).join('  ·  ')));
    }
    story.appendChild(inner);
    story._scroll = 0;
    info = h('div', { class: 'dt-info' },
      h('div', { class: 'dt-info-shade' }),
      h('div', { class: 'dt-info-col' },
        h('div', { class: 't-title bold on-art serif dt-info-name' }, m.name),
        h('div', { class: 't-small on-art dt-info-facts' }, facts),
        h('div', { class: 't-small bold on-art dt-info-h' }, 'The story'),
        story));
    root.appendChild(info);
    ctx.engine.focus(story);
  }

  function closeInfo(refocus = true) {
    infoOpen = false;
    if (info && info.parentNode) info.parentNode.removeChild(info);
    info = null;
    hero.hidden = false;
    if (refocus && infoButton && infoButton.isConnected) ctx.engine.focus(infoButton);
  }

  function scrollStory(by) {
    const story = info && info.querySelector('.dt-story');
    if (!story) return;
    const inner = story.firstChild;
    const max = Math.max(0, inner.offsetHeight - story.clientHeight);
    story._scroll = Math.max(0, Math.min(max, (story._scroll || 0) + by));
    inner.style.transform = 'translate3d(0,' + (-story._scroll) + 'px,0)';
  }

  // ---------- More like this ----------

  function loadSimilar() {
    session.addons().then(async (addons) => {
      for (const addon of addons) {
        let titles = null;
        try { titles = await addon.similar(type, metaId); } catch (e) { titles = null; }
        if (titles && titles.length) return titles;
      }
      return [];
    }).then((titles) => {
      if (dead) return;
      const seen = new Set();
      const list = titles.filter((t) => t.id !== metaId && t.type === type && !seen.has(t.id) && seen.add(t.id)).slice(0, 12);
      if (list.length) { similarTitles = list; buildSimilar(list); showHero(meta); }
    }, () => {});
  }

  /** Movies reveal one Home-sized poster row without moving the title off the screen. */
  function buildSimilar(titles) {
    if (similar && similar.parentNode) similar.parentNode.removeChild(similar);
    similarRow = createRow({
      title: 'More like this', name: 'similar', items: titles.map((t) => ({ id: t.id, name: t.name, poster: t.poster || t.background, meta: t })),
      images: ctx.images,
      onSelect: (it) => ctx.router.push('details', { type: it.meta.type, id: it.meta.id, name: it.meta.name, poster: it.meta.poster, background: it.meta.background }),
    });
    similarRow.el.style.top = '0px';
    ctx.engine.registerGroup(similarRow.el, similarRow.group);
    similar = h('div', { class: 'dt-similar', hidden: true }, h('div', { class: 'dt-similar-shade' }), h('div', { class: 'dt-similar-row' }, similarRow.el));
    root.appendChild(similar);
    similarOpen = false;
  }

  function openSimilar() {
    if (!similar || similarOpen) return;
    similarOpen = true;
    hero.hidden = true;
    similar.hidden = false;
    similar.classList.remove('on');
    void similar.offsetWidth;
    similar.classList.add('on');
    similarRow.focusIndex(0);
  }

  function closeSimilar() {
    similarOpen = false;
    similar.classList.remove('on');
    similar.hidden = true;
    hero.hidden = false;
    focusPlay();
  }

  // ---------- shared ----------

  function openSources(videoId, { startOver = false, next = null, label = null, pick = false } = {}) {
    const m = meta;
    const videos = (m && m.videos) || [];
    const at = videos.findIndex((v) => v.id === videoId);
    const nextId = next || (at >= 0 && videos[at + 1] ? videos[at + 1].id : null);
    const video = at >= 0 ? videos[at] : null;
    const name = (m && m.name) || params.name || '';
    const short = label || (video ? episodeLabel(video) : null);
    ctx.router.push('streams', {
      type, id: metaId, videoId, name, poster: (m && m.poster) || params.poster || null,
      background: (m && m.background) || params.background || null,
      nextVideoId: nextId, startOver, pick,
      label: [name, short].filter((x) => x).join('  ·  '),
      // For the sources page: the title's logo, the episode's still and "S1 E3 · OutKast".
      logo: (m && m.logo) || null, still: video ? video.thumbnail : null, runtime: (m && m.runtime) || null,
      episode: video ? [episodeLabel(video), video.title && video.title.trim() ? video.title : null].filter((x) => x).join('  ·  ') : null,
    });
  }

  return {
    mount(el, p, context) {
      ctx = context;
      session = context.session;
      root = el;
      el.classList.add('dt-screen');
      art = artLayer(ctx.images);
      el.appendChild(art.el);
      el.appendChild(shades());
      clockEl = clock();
      el.appendChild(clockEl.el);
      if (initialArt) art.set(initialArt, { orElse: params.poster || null });
      load();
    },

    unmount() {
      dead = true;
      if (clockEl) clockEl.stop();
      if (similarRow) { ctx.engine.unregisterGroup(similarRow.el); similarRow.destroy(); }
    },

    /** Back from the sources page or the player. */
    resume() {
      refreshItem(true);
    },

    onKey(evt) {
      if (evt.type !== 'press') return false;
      const a = evt.action;
      if (infoOpen) {
        if (a === 'back') { closeInfo(); return true; }
        if (a === 'down') { scrollStory(80); return true; }
        if (a === 'up') { scrollStory(-80); return true; }
        return a === 'left' || a === 'right';
      }
      if (guideOpen) {
        if (a === 'back') { closeGuide(); return true; }
        const focus = ctx.engine.current();
        const onChip = focus && focus.hasAttribute('data-season');
        const at = episodeRows.indexOf(focus);
        if (onChip) {
          if (a === 'down') { if (episodeRows[0]) ctx.engine.focus(episodeRows[0]); return true; }
          if (a === 'up') return true;
        }
        if (at >= 0) {
          if (a === 'left' || a === 'right') return true;
          if (a === 'up' && at === 0) { focusSeason(selectedSeason); return true; }
          if (a === 'down' && at === episodeRows.length - 1) return true;
        }
        return false;
      }
      if (similarOpen) {
        if (a === 'back' || a === 'up') { closeSimilar(); return true; }
        return false;
      }
      if (a === 'down') {
        const focus = ctx.engine.current();
        if (focus && hero && hero.contains(focus) && ((type === 'series' && guide) || (type !== 'series' && similar))) {
          if (type === 'series') openGuide(true); else openSimilar();
          return true;
        }
      }
      return false;
    },
  };
}
