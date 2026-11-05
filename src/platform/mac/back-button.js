/*
 * Mac Back button for the screens where Esc is the only way back (details with Resume / Start over / Add to list, the episode list, the
 * source list, Settings, Search, add-ons, Diagnostics ...). One button, top left, styled like the player's (.mac-back, mac.css); a click is
 * exactly the Esc press: router.onKey({ type: 'press', action: 'back' }), so an open list or dialog closes first, then the screen's own
 * Back handler runs, then the router pops. Shown while the stack is deeper than one screen and the top is not the player (which has its own
 * Back in its bar). Installed by src/main.js's Mac patch (scripts/build.mjs MAIN_PATCHES); the Tizen build never contains it.
 */
export const PLAYER_SCREEN = 'player';

/** Whether the Back button shows for a stack: [depth] screens, top named [top]. */
export function backVisible(depth, top) {
  return depth > 1 && !!top && top !== PLAYER_SCREEN;
}

/** Wraps push / pop / replace / reset of [router] to refresh the button. Returns a function that removes the button and the wrapping. */
export function installBackButton(router, doc = document) {
  const btn = doc.createElement('button');
  btn.className = 'mac-screen-back';
  btn.textContent = '‹  Back';
  btn.style.display = 'none';
  btn.tabIndex = -1;
  btn.addEventListener('mousedown', (e) => e.preventDefault()); // no keyboard focus: Return must not press it a second time
  const host = doc.getElementById('overlay'); // above the screens, under dialogs
  if (host && host.parentNode) host.parentNode.insertBefore(btn, host); else doc.body.appendChild(btn);

  const refresh = () => {
    const top = router.top();
    btn.style.display = backVisible(router.depth(), top && top.name) ? '' : 'none';
  };
  const onClick = (e) => {
    if (e.isTrusted === false) return;
    e.preventDefault();
    e.stopPropagation();
    router.onKey({ type: 'press', action: 'back', repeat: false, event: e });
    refresh();
  };
  btn.addEventListener('click', onClick);

  const originals = {};
  ['push', 'pop', 'replace', 'reset'].forEach((name) => {
    originals[name] = router[name];
    router[name] = function wrapped(...a) {
      const r = originals[name].apply(router, a);
      refresh();
      return r;
    };
  });
  refresh();
  return () => {
    btn.removeEventListener('click', onClick);
    Object.keys(originals).forEach((name) => { router[name] = originals[name]; });
    if (btn.parentNode) btn.parentNode.removeChild(btn);
  };
}
