/**
 * Alder's icon set (res/drawable/ic_*.xml in the Android app), as inline SVG, 24x24, drawn in currentColor.
 * The path data below is generated from the vector drawables; do not edit it by hand. Everything under it is how the
 * paths reach the screen, written for the TV's Chromium M69 (docs/DECISIONS.md "Icons on the TV"):
 *
 *   - every <svg> carries xmlns, a numeric width and height (the box it is drawn in) and a viewBox, so it has a size of
 *     its own wherever it lands: an <svg> with only a viewBox collapsed to 0x0 as a flex item on that engine;
 *   - an icon always sits in a fixed-size `.icon` wrapper (iconEl() makes both); nothing relies on a percentage size;
 *   - iconNode()/iconEl() build the elements with createElementNS (no HTML parsing); iconSvg() is the same thing as a
 *     string for the few call sites that still assign innerHTML, with the same attributes;
 *   - iconImg() is the same picture as an <img> with a data: URI and the colour baked in (the Diagnostics screen draws
 *     both, so one photo says which of the two the TV can draw).
 */
const ICONS = {
  add: '<path d="M19,13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>',
  back: '<path d="M15.41,7.41L14,6l-6,6 6,6 1.41,-1.41L10.83,12z"/>',
  check: '<path d="M9,16.17L4.83,12l-1.42,1.41L9,19 21,7l-1.41,-1.41z"/>',
  close: '<path d="M19,6.41L17.59,5 12,10.59 6.41,5 5,6.41 10.59,12 5,17.59 6.41,19 12,13.41 17.59,19 19,17.59 13.41,12z"/>',
  forward10: '<g transform="translate(24 0) scale(-1 1)"><path d="M12,5V1L7,6l5,5V7c3.31,0 6,2.69 6,6s-2.69,6 -6,6 -6,-2.69 -6,-6H4c0,4.42 3.58,8 8,8s8,-3.58 8,-8 -3.58,-8 -8,-8z"/></g><path d="M10.89,16h-0.85v-3.26l-1.01,0.31v-0.69l1.77,-0.63h0.09L10.89,16zM15.17,14.24c0,0.32 -0.03,0.6 -0.1,0.82s-0.17,0.42 -0.29,0.57 -0.28,0.26 -0.45,0.33 -0.37,0.1 -0.59,0.1 -0.41,-0.03 -0.59,-0.1 -0.33,-0.18 -0.46,-0.33 -0.23,-0.34 -0.3,-0.57 -0.11,-0.5 -0.11,-0.82v-0.74c0,-0.32 0.03,-0.6 0.1,-0.82s0.17,-0.42 0.29,-0.57 0.28,-0.26 0.45,-0.33 0.37,-0.1 0.59,-0.1 0.41,0.03 0.59,0.1 0.33,0.18 0.46,0.33 0.23,0.34 0.3,0.57 0.11,0.5 0.11,0.82v0.74zM14.32,13.38c0,-0.19 -0.01,-0.35 -0.04,-0.48s-0.07,-0.23 -0.12,-0.31 -0.11,-0.14 -0.19,-0.17 -0.16,-0.05 -0.25,-0.05 -0.18,0.02 -0.25,0.05 -0.14,0.09 -0.19,0.17 -0.09,0.18 -0.12,0.31 -0.04,0.29 -0.04,0.48v0.97c0,0.19 0.01,0.35 0.04,0.48s0.07,0.24 0.12,0.32 0.11,0.14 0.19,0.17 0.16,0.05 0.25,0.05 0.18,-0.02 0.25,-0.05 0.14,-0.09 0.19,-0.17 0.09,-0.19 0.11,-0.32 0.04,-0.29 0.04,-0.48v-0.97z"/>',
  home: '<path d="M10,20v-6h4v6h5v-8h3L12,3 2,12h3v8z"/>',
  info: '<path d="M11,7h2v2h-2zM11,11h2v6h-2zM12,2C6.48,2 2,6.48 2,12s4.48,10 10,10 10,-4.48 10,-10S17.52,2 12,2zM12,20c-4.41,0 -8,-3.59 -8,-8s3.59,-8 8,-8 8,3.59 8,8 -3.59,8 -8,8z"/>',
  layers: '<path d="M11.99,18.54l-7.37,-5.73L3,14.07l9,7 9,-7 -1.63,-1.27zM12,16l7.36,-5.73L21,9l-9,-7 -9,7 1.63,1.27L12,16zM12,4.53L17.74,9 12,13.47 6.26,9 12,4.53z"/>',
  mic: '<path d="M12,2a4,4 0,0 0,-4 4v6a4,4 0,0 0,8 0V6a4,4 0,0 0,-4 -4z M5,11a7,7 0,0 0,14 0 M12,18v4 M8,22h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  movie: '<path d="M18,4l2,4h-3l-2,-4h-2l2,4h-3l-2,-4H8l2,4H7L5,4H4c-1.1,0 -1.99,0.9 -1.99,2L2,18c0,1.1 0.9,2 2,2h16c1.1,0 2,-0.9 2,-2V4h-4z"/>',
  next_episode: '<path d="M4,4v16l12,-8zM18,4h2v16h-2z"/>',
  pause: '<path d="M6,19h4V5H6v14zM14,5v14h4V5h-4z"/>',
  play: '<path d="M8,5v14l11,-7z"/>',
  replay10: '<path d="M12,5V1L7,6l5,5V7c3.31,0 6,2.69 6,6s-2.69,6 -6,6 -6,-2.69 -6,-6H4c0,4.42 3.58,8 8,8s8,-3.58 8,-8 -3.58,-8 -8,-8z"/><path d="M10.89,16h-0.85v-3.26l-1.01,0.31v-0.69l1.77,-0.63h0.09L10.89,16zM15.17,14.24c0,0.32 -0.03,0.6 -0.1,0.82s-0.17,0.42 -0.29,0.57 -0.28,0.26 -0.45,0.33 -0.37,0.1 -0.59,0.1 -0.41,-0.03 -0.59,-0.1 -0.33,-0.18 -0.46,-0.33 -0.23,-0.34 -0.3,-0.57 -0.11,-0.5 -0.11,-0.82v-0.74c0,-0.32 0.03,-0.6 0.1,-0.82s0.17,-0.42 0.29,-0.57 0.28,-0.26 0.45,-0.33 0.37,-0.1 0.59,-0.1 0.41,0.03 0.59,0.1 0.33,0.18 0.46,0.33 0.23,0.34 0.3,0.57 0.11,0.5 0.11,0.82v0.74zM14.32,13.38c0,-0.19 -0.01,-0.35 -0.04,-0.48s-0.07,-0.23 -0.12,-0.31 -0.11,-0.14 -0.19,-0.17 -0.16,-0.05 -0.25,-0.05 -0.18,0.02 -0.25,0.05 -0.14,0.09 -0.19,0.17 -0.09,0.18 -0.12,0.31 -0.04,0.29 -0.04,0.48v0.97c0,0.19 0.01,0.35 0.04,0.48s0.07,0.24 0.12,0.32 0.11,0.14 0.19,0.17 0.16,0.05 0.25,0.05 0.18,-0.02 0.25,-0.05 0.14,-0.09 0.19,-0.17 0.09,-0.19 0.11,-0.32 0.04,-0.29 0.04,-0.48v-0.97z"/>',
  search: '<path d="M10.8,2.8a8,8 0,1 0,0 16a8,8 0,0 0,0 -16zM10.8,5a5.8,5.8 0,1 1,0 11.6a5.8,5.8 0,0 1,0 -11.6zM16.7,15.2l5.1,5.1l-1.5,1.5l-5.1,-5.1z"/>',
  settings: '<path d="M19.14,12.94c0.04,-0.3 0.06,-0.61 0.06,-0.94c0,-0.32 -0.02,-0.64 -0.07,-0.94l2.03,-1.58c0.18,-0.14 0.23,-0.41 0.12,-0.61l-1.92,-3.32c-0.12,-0.22 -0.37,-0.29 -0.59,-0.22l-2.39,0.96c-0.5,-0.38 -1.03,-0.7 -1.62,-0.94L14.4,2.81c-0.04,-0.24 -0.24,-0.41 -0.48,-0.41h-3.84c-0.24,0 -0.43,0.17 -0.47,0.41L9.25,5.35C8.66,5.59 8.12,5.92 7.63,6.29L5.24,5.33c-0.22,-0.08 -0.47,0 -0.59,0.22L2.74,8.87C2.62,9.08 2.66,9.34 2.86,9.48l2.03,1.58C4.84,11.36 4.8,11.69 4.8,12s0.02,0.64 0.07,0.94l-2.03,1.58c-0.18,0.14 -0.23,0.41 -0.12,0.61l1.92,3.32c0.12,0.22 0.37,0.29 0.59,0.22l2.39,-0.96c0.5,0.38 1.03,0.7 1.62,0.94l0.36,2.54c0.05,0.24 0.24,0.41 0.48,0.41h3.84c0.24,0 0.44,-0.17 0.47,-0.41l0.36,-2.54c0.59,-0.24 1.13,-0.56 1.62,-0.94l2.39,0.96c0.22,0.08 0.47,0 0.59,-0.22l1.92,-3.32c0.12,-0.22 0.07,-0.47 -0.12,-0.61L19.14,12.94zM12,15.6c-1.98,0 -3.6,-1.62 -3.6,-3.6s1.62,-3.6 3.6,-3.6s3.6,1.62 3.6,3.6S13.98,15.6 12,15.6z"/>',
  subtitles: '<path d="M20,4H4c-1.1,0 -2,0.9 -2,2v12c0,1.1 0.9,2 2,2h16c1.1,0 2,-0.9 2,-2V6c0,-1.1 -0.9,-2 -2,-2zM20,18H4V6h16v12zM6,10h2v2H6zM6,14h8v2H6zM16,14h2v2h-2zM10,10h8v2h-8z"/>',
  tv: '<path d="M21,3H3c-1.1,0 -2,0.9 -2,2v12c0,1.1 0.9,2 2,2h5v2h8v-2h5c1.1,0 1.99,-0.9 1.99,-2L23,5c0,-1.1 -0.9,-2 -2,-2zM21,17H3V5h18v12z"/>',
};

const NS = 'http://www.w3.org/2000/svg';
export const ICON_BOX = 24; // the drawing's own size (its viewBox)

/** The two inks the Diagnostics screen draws with, and what an icon gets when a script paints it (see paintIcon). */
export const INK_LIGHT = '#F3EEE6';
export const INK_DARK = '#15110E';

/** The body of icon [name] with every `currentColor` replaced by [color]. */
function bodyIn(body, color) {
  return color === 'currentColor' ? body : body.split('currentColor').join(color);
}

function sizeOf(size) {
  const n = Math.round(Number(size));
  return n > 0 ? n : ICON_BOX;
}

/**
 * The SVG markup of icon [name], [size] px square, filled with [color]; '' when unknown. Explicit xmlns, width, height and
 * viewBox. For innerHTML; build elements with iconEl() where you can.
 */
export function iconSvg(name, size = ICON_BOX, color = 'currentColor') {
  const body = ICONS[name];
  if (!body) return '';
  const px = sizeOf(size);
  return '<svg xmlns="' + NS + '" width="' + px + '" height="' + px + '" viewBox="0 0 ' + ICON_BOX + ' ' + ICON_BOX + '" fill="' + color +
    '" focusable="false" aria-hidden="true">' + bodyIn(body, color) + '</svg>';
}

/**
 * The elements of an icon body as [{tag, attrs, children}]: the bodies are only <path> and <g>, so a small reader does.
 * (Pure, no DOM: tested under Node.)
 */
export function parseBody(body) {
  const root = { tag: 'svg', attrs: {}, children: [] };
  const stack = [root];
  const tag = /<(\/?)([a-z]+)([^>]*?)(\/?)>/g;
  let m;
  while ((m = tag.exec(body))) {
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    const attrs = {};
    const attr = /([a-z-]+)="([^"]*)"/g;
    let a;
    while ((a = attr.exec(m[3]))) attrs[a[1]] = a[2];
    const node = { tag: m[2], attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!m[4]) stack.push(node);
  }
  return root.children;
}

function build(doc, node, color) {
  const el = doc.createElementNS(NS, node.tag);
  Object.keys(node.attrs).forEach((k) => el.setAttribute(k, node.attrs[k] === 'currentColor' ? color : node.attrs[k]));
  node.children.forEach((c) => el.appendChild(build(doc, c, color)));
  return el;
}

/** An <svg> element for icon [name]: createElementNS, xmlns, numeric width and height, viewBox, explicit fill. null when unknown. */
export function iconNode(name, size = ICON_BOX, color = 'currentColor') {
  const body = ICONS[name];
  if (!body) return null;
  const px = sizeOf(size);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('xmlns', NS);
  svg.setAttribute('width', String(px));
  svg.setAttribute('height', String(px));
  svg.setAttribute('viewBox', '0 0 ' + ICON_BOX + ' ' + ICON_BOX);
  svg.setAttribute('fill', color);
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('aria-hidden', 'true');
  parseBody(body).forEach((n) => svg.appendChild(build(document, n, color)));
  return svg;
}

/**
 * The `.icon` wrapper with the icon in it: a fixed [size] px box (inline style, no stylesheet needed) and an <svg> of that
 * size. [color] 'currentColor' follows the CSS colour; a colour value is painted in. className adds classes to the wrapper.
 */
export function iconEl(name, size = ICON_BOX, { color = 'currentColor', className = '' } = {}) {
  const px = sizeOf(size);
  const span = document.createElement('span');
  span.className = 'icon' + (className ? ' ' + className : '');
  span.style.width = px + 'px';
  span.style.height = px + 'px';
  const svg = iconNode(name, px, color);
  if (svg) span.appendChild(svg);
  return span;
}

/** Puts icon [name] in the wrapper [span] in place of what it holds (Play becomes Pause). */
export function swapIcon(span, name, size = ICON_BOX, color = 'currentColor') {
  while (span.firstChild) span.removeChild(span.firstChild);
  const svg = iconNode(name, size, color);
  if (svg) span.appendChild(svg);
}

/** Paints every <svg> under [root] with [color]: the fill, and the stroke of the shapes drawn with one (mic). */
export function paintIcon(root, color) {
  const svgs = root.tagName && root.tagName.toLowerCase() === 'svg' ? [root] : Array.prototype.slice.call(root.querySelectorAll('svg'));
  svgs.forEach((svg) => {
    svg.setAttribute('fill', color);
    Array.prototype.forEach.call(svg.querySelectorAll('[stroke]'), (e) => e.setAttribute('stroke', color));
  });
}

/** icon [name] as a data: URI of an SVG with [color] baked in (the # and < of an SVG are percent-encoded). '' when unknown. */
export function iconDataUri(name, color = INK_LIGHT, size = 48) {
  const svg = iconSvg(name, size, color);
  return svg ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) : '';
}

/** An <img> of icon [name]: a data: URI, width and height set, colour baked in. The fallback if inline <svg> ever fails. */
export function iconImg(name, size = ICON_BOX, color = INK_LIGHT) {
  const px = sizeOf(size);
  const img = document.createElement('img');
  img.setAttribute('width', String(px));
  img.setAttribute('height', String(px));
  img.setAttribute('alt', '');
  img.style.display = 'block';
  img.src = iconDataUri(name, color, px);
  return img;
}

export const ICON_NAMES = Object.keys(ICONS);
