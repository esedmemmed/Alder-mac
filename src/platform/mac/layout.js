/*
 * Mac layout. The app is laid out at 1920 px wide; a Mac window is any size and shape. Scale = innerWidth / 1920, and the
 * logical height is innerHeight / scale (1440 x 900 -> 1920 x 1200), published as --app-h (the Mac build rewrites the
 * shared CSS's `height: 1080px` to var(--app-h, 1080px), scripts/build.mjs). The body is scaled with a transform from its
 * top-left corner; html is the real window size and clips. Imported for its effect by src/main.js (build.mjs MAIN_PATCHES),
 * so the Tizen build never contains it.
 */
const DESIGN_W = 1920;

export function applyLayout(win = window) {
  const w = win.innerWidth, h = win.innerHeight;
  if (!w || !h) return;
  const scale = w / DESIGN_W;
  const root = win.document.documentElement;
  root.style.setProperty('--app-h', Math.round(h / scale) + 'px');
  root.style.width = w + 'px';
  root.style.height = h + 'px';
  const body = win.document.body;
  body.style.transformOrigin = '0 0';
  body.style.transform = 'scale(' + scale + ')';
}

applyLayout();
window.addEventListener('resize', () => applyLayout());

// Safari 14 ignores focus({ preventScroll: true }), so focusing a card past a row's edge scrolls the overflow:hidden ancestors
// (.screen, body, html) sideways and cuts the side menu in half (T12.1.1). Nothing in the app scrolls by scrollLeft/Top (rows and
// lists move by transform), so any such scroll is put back at once, before the frame paints. Text fields scroll their own text.
window.addEventListener('scroll', (e) => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  const el = !t || t === document || t === document.documentElement ? document.scrollingElement : t;
  if (el && (el.scrollLeft || el.scrollTop)) { el.scrollLeft = 0; el.scrollTop = 0; }
}, true);
