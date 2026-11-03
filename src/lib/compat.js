/*
 * Polyfills for what Tizen 5.5's web engine (Chromium M69) lacks (PLAN.md section 2). esbuild lowers syntax but
 * never adds APIs, so any API newer than M69 that the app uses has to be here. scripts/compat-check.mjs reads
 * POLYFILLED below: an API listed there may be used in src/, one that is not listed fails the check.
 *
 * Not polyfillable and therefore forbidden everywhere: CompressionStream, DecompressionStream, ResizeObserver
 * (use pako, and measure on focus / render instead).
 */

/** Names the compat check allows in src/ because this file provides them. Keep in step with install() below. */
export const POLYFILLED = [
  'Promise.allSettled', 'Promise.any', 'AggregateError', 'Object.fromEntries', 'Object.hasOwn',
  'String.prototype.replaceAll', 'String.prototype.matchAll', 'String.prototype.at',
  'Array.prototype.at', 'Array.prototype.findLast', 'Array.prototype.findLastIndex',
  'structuredClone', 'queueMicrotask', 'globalThis', 'Element.prototype.replaceChildren',
];

function allSettled(iterable) {
  return Promise.all(Array.from(iterable, (p) => Promise.resolve(p).then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason }),
  )));
}

class AggregateErrorPoly extends Error {
  constructor(errors, message) {
    super(message === undefined ? '' : String(message));
    this.name = 'AggregateError';
    this.errors = Array.from(errors);
  }
}

/** Resolves with the first fulfilment, rejects with an AggregateError when every promise rejected. */
function any(iterable, AggregateErrorCtor = AggregateErrorPoly) {
  const list = Array.from(iterable);
  return new Promise((resolve, reject) => {
    if (list.length === 0) return reject(new AggregateErrorCtor([], 'All promises were rejected'));
    const errors = new Array(list.length);
    let left = list.length;
    list.forEach((p, i) => Promise.resolve(p).then(resolve, (e) => {
      errors[i] = e;
      if (--left === 0) reject(new AggregateErrorCtor(errors, 'All promises were rejected'));
    }));
  });
}

function fromEntries(iterable) {
  const out = {};
  for (const [k, v] of iterable) out[k] = v;
  return out;
}

function hasOwn(obj, key) {
  if (obj == null) throw new TypeError('Cannot convert undefined or null to object');
  return Object.prototype.hasOwnProperty.call(Object(obj), key);
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function replaceAll(search, replacement) {
  const text = String(this);
  if (search instanceof RegExp) {
    if (!search.global) throw new TypeError('replaceAll must be called with a global RegExp');
    return text.replace(search, replacement);
  }
  // A string pattern: every occurrence, with the same $-patterns and function replacers String#replace has.
  return text.replace(new RegExp(escapeRegExp(String(search)), 'g'), replacement);
}

function* matchAll(regexp) {
  const text = String(this);
  const re = regexp instanceof RegExp ? regexp : new RegExp(regexp, 'g');
  if (!re.global) throw new TypeError('matchAll must be called with a global RegExp');
  // Work on a copy so the caller's lastIndex is untouched, as the real one does.
  const copy = new RegExp(re.source, re.flags);
  copy.lastIndex = re.lastIndex;
  let m;
  while ((m = copy.exec(text)) !== null) {
    yield m;
    if (m[0] === '') copy.lastIndex++; // an empty match would loop forever
  }
}

function at(index) {
  const n = Math.trunc(Number(index)) || 0;
  const i = n < 0 ? this.length + n : n;
  return i < 0 || i >= this.length ? undefined : this[i];
}

function findLastIndex(pred, thisArg) {
  for (let i = this.length - 1; i >= 0; i--) if (pred.call(thisArg, this[i], i, this)) return i;
  return -1;
}

function findLast(pred, thisArg) {
  const i = findLastIndex.call(this, pred, thisArg);
  return i < 0 ? undefined : this[i];
}

/** Deep copy of plain data (objects, arrays, Date, Map, Set), cycles included. Functions throw, as in the real one. */
function structuredCloneImpl(value, seen = new Map()) {
  if (typeof value === 'function' || typeof value === 'symbol') throw new Error('DataCloneError: value cannot be cloned');
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value.getTime());
  let out;
  if (value instanceof Map) {
    out = new Map(); seen.set(value, out);
    value.forEach((v, k) => out.set(structuredCloneImpl(k, seen), structuredCloneImpl(v, seen)));
  } else if (value instanceof Set) {
    out = new Set(); seen.set(value, out);
    value.forEach((v) => out.add(structuredCloneImpl(v, seen)));
  } else if (Array.isArray(value)) {
    out = []; seen.set(value, out);
    value.forEach((v, i) => { out[i] = structuredCloneImpl(v, seen); });
  } else {
    out = {}; seen.set(value, out);
    Object.keys(value).forEach((k) => { out[k] = structuredCloneImpl(value[k], seen); });
  }
  return out;
}

function queueMicrotaskImpl(fn) {
  if (typeof fn !== 'function') throw new TypeError('queueMicrotask callback must be a function');
  // An exception in the callback must not vanish into the promise: rethrow it from a timer, as the real one reports it.
  Promise.resolve().then(fn).catch((e) => setTimeout(() => { throw e; }, 0));
}

function replaceChildren(...nodes) {
  while (this.firstChild) this.removeChild(this.firstChild);
  nodes.forEach((n) => this.appendChild(typeof n === 'string' ? this.ownerDocument.createTextNode(n) : n));
}

/** Exposed for the unit tests: the implementations, callable without touching any global. */
export const impl = { allSettled, any, fromEntries, hasOwn, replaceAll, matchAll, at, findLast, findLastIndex,
  structuredClone: structuredCloneImpl, queueMicrotask: queueMicrotaskImpl, replaceChildren, AggregateError: AggregateErrorPoly };

function define(target, name, value) {
  if (target && target[name] === undefined) {
    Object.defineProperty(target, name, { value, writable: true, configurable: true, enumerable: false });
    return true;
  }
  return false;
}

/**
 * Adds every missing API to [g] (the window). Returns the names it added, so Diagnostics can show what this TV needed.
 * [g] is a parameter so tests can run it against a bare fake global.
 */
export function install(g) {
  const added = [];
  const put = (target, name, value, label) => { if (define(target, name, value)) added.push(label); };
  put(g, 'AggregateError', AggregateErrorPoly, 'AggregateError');
  put(g.Promise, 'allSettled', allSettled, 'Promise.allSettled');
  put(g.Promise, 'any', function (it) { return any(it, g.AggregateError); }, 'Promise.any');
  put(g.Object, 'fromEntries', fromEntries, 'Object.fromEntries');
  put(g.Object, 'hasOwn', hasOwn, 'Object.hasOwn');
  put(g.String && g.String.prototype, 'replaceAll', replaceAll, 'String.prototype.replaceAll');
  put(g.String && g.String.prototype, 'matchAll', matchAll, 'String.prototype.matchAll');
  put(g.String && g.String.prototype, 'at', at, 'String.prototype.at');
  put(g.Array && g.Array.prototype, 'at', at, 'Array.prototype.at');
  put(g.Array && g.Array.prototype, 'findLast', findLast, 'Array.prototype.findLast');
  put(g.Array && g.Array.prototype, 'findLastIndex', findLastIndex, 'Array.prototype.findLastIndex');
  put(g, 'structuredClone', (v) => structuredCloneImpl(v), 'structuredClone');
  put(g, 'queueMicrotask', queueMicrotaskImpl, 'queueMicrotask');
  if (g.Element) put(g.Element.prototype, 'replaceChildren', replaceChildren, 'Element.prototype.replaceChildren');
  if (typeof g.globalThis === 'undefined') { g.globalThis = g; added.push('globalThis'); }
  return added;
}

/** Names installed at start-up (empty on an engine that has everything). Read by the Diagnostics screen. */
export let installed = [];

if (typeof window !== 'undefined') installed = install(window);
