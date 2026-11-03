/*
 * The art behind Home (Alder's MainActivity art / artBack / `shaded`): one title's picture full bleed, crossfading from the
 * last title's, with the shades that Alder paints into the bitmap (left behind the words, a long one up from the foot, a
 * hint at the top, a soft vignette) as one static overlay. Docs/home-dune.png.
 *
 * Differences from Android: the shades are CSS gradients over the picture (the bitmap cannot be redrawn here), the left
 * shade is always the 0xEB strength (Alder samples the picture's left edge to choose 0xF7 for a bright one, which needs
 * pixels; a cross-origin <img> cannot be read), and the 20 s slow zoom is left out (a full-screen layer scaling for twenty
 * seconds is exactly the kind of animation this TV cannot afford). See DECISIONS.md.
 */
import { h } from '../lib/dom.js';
import { sharp } from '../lib/images.js';

export const ART_WAIT = 120; // ms a picture waits before it is asked for, so racing along a row starts no download per card
const FADE_FIRST = 800; // ms: the first picture in
const FADE_NEXT = 600;  // ms: one over another

export function createArt(images, { width = 1920, timers = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t) } } = {}) {
  const back = h('img', { class: 'art-img', alt: '' });
  const front = h('img', { class: 'art-img', alt: '' });
  const shade = h('div', { class: 'art-shade' });
  const el = h('div', { class: 'art' }, back, front, shade);
  let current = null; // the url asked for last
  let wait = null;
  let release = null;

  const stop = (t) => { if (t) timers.clearTimeout(t); };

  /**
   * Shows [url]. Art that is already here shows at once; otherwise it waits a beat. [ready] runs once it is showing (or at
   * once when it already is, or when it could not be had).
   */
  function show(url, { ready = null, immediate = false } = {}) {
    stop(wait);
    if (!url) return;
    if (url === current) { if (ready) ready(); return; }
    const go = () => {
      stop(release);
      // Racing along a row cancels fades midway: only a picture that is mostly in replaces the one behind, otherwise the
      // back keeps the last full picture and nothing flashes dark.
      if (front.classList.contains('on') && front.getAttribute('src')) {
        back.src = front.getAttribute('src');
        back.classList.add('on');
      }
      const first = !back.getAttribute('src');
      front.style.transitionDuration = (first ? FADE_FIRST : FADE_NEXT) + 'ms';
      front.classList.remove('on');
      current = url;
      images.load(front, sharp(url, width), {
        urgent: true,
        onDone() {
          if (current !== url) return;
          front.classList.add('on');
          // Once the new art covers it, the old one lets go.
          stop(release);
          release = timers.setTimeout(() => { if (current === url) { back.classList.remove('on'); back.removeAttribute('src'); } }, (first ? FADE_FIRST : FADE_NEXT) + 60);
          if (ready) ready();
        },
        onFail() { if (current === url) current = null; if (ready) ready(); },
      });
    };
    if (immediate || images.cached(sharp(url, width))) go(); else wait = timers.setTimeout(go, ART_WAIT);
  }

  return {
    el,
    show,
    get url() { return current; },
    /** An empty page: nothing behind it. */
    clear() {
      stop(wait); stop(release);
      current = null;
      images.cancel(front);
      front.classList.remove('on');
      back.classList.remove('on');
      front.removeAttribute('src');
      back.removeAttribute('src');
    },
    destroy() { stop(wait); stop(release); images.cancel(front); },
  };
}
