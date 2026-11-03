/*
 * Shared pieces of the picker, the PIN screen and the sign-in (Alder's onboardingFrame, onboardingAvatar, brand): the mark and
 * the serif "Alder", a round portrait with the person's initial, the colour swatches, the two-column frame with the step dots,
 * and a backdrop made from one film's art without blur (a 64 x 36 copy stretched over the screen is as soft as Alder's frost).
 */
import { h, cls } from '../lib/dom.js';
import { iconEl } from './icons.js';
import { COLORS } from '../core/profiles.js';

/** The mark beside the serif "Alder", top left of the picker and the sign-in. */
export function brand() {
  return h('div', { class: 'ob-brand' }, h('span', { class: 'ob-mark' }), h('span', { class: 'ob-word' }, 'Alder'));
}

export const initialOf = (name) => (name ? Array.from(String(name).trim())[0] || '' : '').toUpperCase();

/** A portrait: the colour with the initial in serif, [size] px. */
export function avatar(name, color, size = 200) {
  const el = h('div', { class: 'ob-avatar', style: { width: size + 'px', height: size + 'px', background: color, fontSize: Math.round(size * 0.48) + 'px', lineHeight: size + 'px' } }, initialOf(name));
  el.setName = (n) => { el.textContent = initialOf(n); };
  el.setColor = (c) => { el.style.background = c; };
  return el;
}

/** Five portrait colours as focusable discs; the chosen one carries a tick. onPick(color). */
export function swatches(selected, onPick) {
  const discs = COLORS.map((color) => {
    const el = h('div', { class: 'ob-swatch', 'data-focus': '', tabindex: '-1', role: 'button', style: { background: color } });
    el.addEventListener('click', () => { mark(color); onPick(color); });
    return { color, el };
  });
  function mark(color) {
    discs.forEach((d) => {
      d.el.classList.toggle('on', d.color === color);
      while (d.el.firstChild) d.el.removeChild(d.el.firstChild);
      if (d.color === color) d.el.appendChild(iconEl('check', 30));
    });
  }
  mark(selected);
  return { el: h('div', { class: 'ob-swatches' }, discs.map((d) => d.el)), mark };
}

/**
 * The two-column frame: brand and step dots on top, [left] and [right] below. step: { now, total, label } or null.
 * leftWidth: px, or 0 for "as the other half".
 */
export function frame({ step = null, left, right, leftWidth = 0, className = '' }) {
  const dots = [];
  if (step) for (let i = 0; i < step.total; i++) dots.push(h('i', { class: i < step.now ? 'on' : '' }));
  const top = h('div', { class: 'ob-top' }, brand(), step ? h('span', { class: 't-small t-2' }, step.label) : null, dots);
  const l = h('div', { class: 'ob-left', style: leftWidth ? { width: leftWidth + 'px', flex: 'none' } : null }, left);
  const r = h('div', { class: 'ob-right' }, right);
  return h('div', { class: cls('ob-frame', className) }, h('div', { class: 'ob-backdrop' }, h('div', { class: 'ob-scene' })), top, h('div', { class: 'ob-body' }, l, r));
}

/**
 * A full-screen backdrop from a picture: the art copied to a tiny canvas and stretched, so it is soft without a blur filter. Until
 * there is a picture (and for the sign-in steps) it is Alder's own night scene, dimmed (onboarding_scene).
 * Returns { el, show(url, images) }: show() loads the picture through the image loader and fades it in.
 */
export function backdrop() {
  const canvas = h('canvas', { class: 'ob-backdrop-art', width: 64, height: 36 });
  const el = h('div', { class: 'ob-backdrop' }, h('div', { class: 'ob-scene' }), canvas, h('div', { class: 'ob-backdrop-shade' }));
  let token = 0;
  return {
    el,
    show(url, images) {
      const mine = ++token;
      if (!url || !images) { canvas.classList.remove('on'); el.classList.remove('has-art'); return; }
      const img = new Image();
      images.load(img, url, {
        urgent: true,
        onDone() {
          if (mine !== token) return;
          const draw = () => {
            if (mine !== token) return;
            try { canvas.getContext('2d').drawImage(img, 0, 0, 64, 36); canvas.classList.add('on'); el.classList.add('has-art'); } catch (e) { /* no picture: the scene stays */ }
          };
          if (img.complete) draw(); else img.onload = draw;
        },
        onFail() { if (mine === token) { canvas.classList.remove('on'); el.classList.remove('has-art'); } },
      });
    },
    hide() { token++; canvas.classList.remove('on'); el.classList.remove('has-art'); },
  };
}
