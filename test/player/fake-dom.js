// A tiny document for the tests that build a panel without a browser: elements keep their attributes, children and text; no layout.
class El {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.parentNode = null; this.attrs = {}; this.listeners = {};
    this.style = { setProperty() {} }; this._text = ''; this.clientHeight = 1000; this.offsetTop = 0; this.offsetHeight = 10;
    const self = this;
    this.classList = { add() {}, remove() {}, toggle() {}, contains: (c) => (self.attrs.class || '').split(' ').includes(c) };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
  addEventListener() {}
  get firstChild() { return this.children[0] || null; }
  set innerHTML(v) { this.children = []; this._text = ''; }
  get innerHTML() { return ''; }
  set textContent(v) { this.children = []; this._text = String(v); }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  querySelectorAll() { return []; }
}
class Text { constructor(t) { this.textContent = t; } }

/** Installs a global `document`; call remove() after. */
export function installFakeDom() {
  const before = globalThis.document;
  globalThis.document = { createElement: (t) => new El(t), createElementNS: (ns, t) => new El(t), createTextNode: (t) => new Text(t) };
  return { host: new El('div'), remove() { globalThis.document = before; } };
}

/** Every text in the tree, in order, one per element that holds text directly. */
export function texts(el, out = []) {
  if (el._text) out.push(el._text);
  (el.children || []).forEach((c) => (c instanceof Text ? out.push(c.textContent) : texts(c, out)));
  return out;
}
