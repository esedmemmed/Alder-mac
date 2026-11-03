/*
 * Small DOM helpers: no framework, no virtual DOM. h() builds elements, cls() joins class names.
 * Everything reads `document` when called (never at import), so the module loads under Node for the tests.
 */

/** Joins class names: strings, arrays, and objects of {name: truthy}. Falsy values are dropped. */
export function cls(...parts) {
  const out = [];
  for (const p of parts) {
    if (!p) continue;
    if (typeof p === 'string') out.push(p);
    else if (Array.isArray(p)) { const inner = cls(...p); if (inner) out.push(inner); }
    else if (typeof p === 'object') for (const k of Object.keys(p)) if (p[k]) out.push(k);
  }
  return out.join(' ');
}

function appendChild(parent, child, doc) {
  if (child == null || child === false || child === true) return;
  if (Array.isArray(child)) { child.forEach((c) => appendChild(parent, c, doc)); return; }
  parent.appendChild(typeof child === 'object' ? child : doc.createTextNode(String(child)));
}

/**
 * h('div', {class: 'card', 'data-focus': '', style: {left: '10px'}, onclick: fn}, child, [children], 'text')
 *  - class / className: see cls(); style: object (custom properties allowed) or string
 *  - on<event>: addEventListener; html: trusted innerHTML (icons only); ref: called with the element
 *  - false / null / undefined attributes are skipped, true is an empty attribute
 */
export function h(tag, props, ...children) {
  const doc = document;
  const el = doc.createElement(tag);
  if (props) {
    for (const key of Object.keys(props)) {
      const value = props[key];
      if (value == null || value === false) continue;
      if (key === 'class' || key === 'className') { const c = cls(value); if (c) el.setAttribute('class', c); }
      else if (key === 'style') {
        if (typeof value === 'string') el.setAttribute('style', value);
        else for (const name of Object.keys(value)) {
          if (value[name] == null) continue;
          if (name.charAt(0) === '-') el.style.setProperty(name, String(value[name])); else el.style[name] = value[name];
        }
      } else if (key === 'html') el.innerHTML = value;
      else if (key === 'ref') value(el);
      else if (key.length > 2 && key.charAt(0) === 'o' && key.charAt(1) === 'n') el.addEventListener(key.slice(2).toLowerCase(), value);
      else el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const c of children) appendChild(el, c, doc);
  return el;
}

/** Removes every child of [el]. */
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Sets [el]'s text only when it changed: assigning identical text still invalidates layout. */
export function setText(el, text) {
  const t = String(text);
  if (el.textContent !== t) el.textContent = t;
  return el;
}

/** transform: translate3d, in px. The one thing the UI animates (with opacity), so it has a helper. */
export function translate(el, x, y) {
  el.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
}

/** Index of the first element of [list] for which [pred] holds, from the end. For code that avoids findLast. */
export function lastIndexWhere(list, pred) {
  for (let i = list.length - 1; i >= 0; i--) if (pred(list[i], i)) return i;
  return -1;
}
