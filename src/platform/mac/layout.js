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
