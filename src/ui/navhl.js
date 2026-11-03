/*
 * The top bar's focus highlight (docs/PLAN-v0.2.md section A): ONE solid warm-white pill behind the focused tab that slides from
 * tab to tab. It is a container moved with translateX, holding a left cap, a right cap and a middle that is scaled in X, so the
 * ends stay round at any tab width and only transform and opacity animate (no width, no layout). The tabs are measured with
 * offsetLeft / offsetWidth when focus lands on them (the tab's bolder "current page" label is drawn with a text stroke, so its
 * width never changes and one measure stays true).
 *
 * It listens for `focusin` on the document instead of being wired by each screen: Home and Search both have a `.navpill`, and a
 * pill the remote is not in simply fades its highlight out. Importing this module is what installs it.
 *
 * The geometry is pure (highlightBox) so it is tested without a DOM.
 */

const CAP = 34;     // half the highlight's height (68 px), the radius of its ends

/** The transforms for a highlight over a tab at [left] with [width]: the container, the scaled middle and the right cap. */
export function highlightBox(left, width, cap = CAP) {
  const w = Math.max(width, cap * 2);
  return {
    box: 'translate3d(' + left + 'px,0,0)',
    // the middle is 1 px wide, scaled to the gap between the caps plus 1 px of overlap each side (no seam where the edges meet)
    mid: 'translate3d(' + (cap - 1) + 'px,0,0) scaleX(' + (w - 2 * cap + 2) + ')',
    right: 'translate3d(' + (w - cap) + 'px,0,0)',
  };
}

function build(pill) {
  const el = document.createElement('div');
  el.className = 'nav-hl snap';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<i class="l"></i><i class="m"></i><i class="r"></i>';
  pill.insertBefore(el, pill.firstChild);
  return el;
}

let lit = null; // the highlight that is showing

function hide() {
  if (lit) { lit.classList.remove('on'); lit = null; }
}

/** Slides the highlight of [pill] to [item]. The first time it shows, it appears in place instead of flying in from the corner. */
export function moveHighlight(pill, item) {
  let hl = pill.querySelector('.nav-hl');
  if (!hl) hl = build(pill);
  const b = highlightBox(item.offsetLeft, item.offsetWidth);
  const fresh = !hl.classList.contains('on');
  if (fresh) hl.classList.add('snap');
  hl.style.transform = b.box;
  hl.children[1].style.transform = b.mid;
  hl.children[2].style.transform = b.right;
  if (fresh) { void hl.offsetWidth; hl.classList.remove('snap'); }
  if (lit && lit !== hl) lit.classList.remove('on');
  hl.classList.add('on');
  lit = hl;
}

function onFocusIn(e) {
  const t = e.target;
  const pill = t && t.closest ? t.closest('.navpill') : null;
  if (pill && t.classList.contains('nav-item')) moveHighlight(pill, t);
  else hide();
}

function onFocusOut(e) {
  const to = e.relatedTarget;
  if (!to || !to.closest || !to.closest('.navpill')) hide();
}

if (typeof document !== 'undefined' && !document.__alderNavHl) {
  document.__alderNavHl = true;
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
}
