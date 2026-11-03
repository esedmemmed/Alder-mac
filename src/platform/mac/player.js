/*
 * Mac player stub, for the module swap in scripts/build.mjs (npm run build:mac): replaces src/player/screen.js, so no
 * engine is created and nothing can fail over. Playback arrives with the native player (mpv) in the next version. The
 * screen says so, tells the shell through the bridge (log), and Back returns to the source list.
 */
import { h } from '../../lib/dom.js';
import { macBridge } from './bridge.js';

export const PLAYBACK_MESSAGE = 'Playback comes in the next version';

export function createPlayerScreen() {
  let ctx = null;
  return {
    mount(el, p, context) {
      ctx = context;
      el.classList.add('pl-screen');
      el.appendChild(h('div', {
        class: 'pl-mac-stub', role: 'status',
        style: 'position:absolute;left:0;top:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;' +
          'text-align:center;font-size:28px;color:#fff;background:#0b0b0b',
      }, PLAYBACK_MESSAGE));
      const bridge = macBridge();
      if (bridge) bridge.log('player stub: playback not available yet').catch(() => {});
    },
    unmount() {},
    /** Every key is the player's; Back leaves to the source list. */
    onKey(evt) {
      if (evt.type === 'press' && evt.action === 'back' && !evt.repeat) ctx.router.pop();
      return true;
    },
  };
}

export const playerScreens = { player: createPlayerScreen };
