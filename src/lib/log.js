/*
 * A ring buffer of the last N log lines, shown on the Diagnostics screen (the owner has a phone and a remote,
 * no logcat) and mirrored to the console. createLogger() takes everything it touches so the tests need no window.
 */

const LEVELS = ['debug', 'info', 'warn', 'error'];

/** One value as a short string: objects as JSON (never throws), long text cut. */
export function stringify(value, max = 500) {
  let s;
  if (typeof value === 'string') s = value;
  else if (value instanceof Error) s = value.name + ': ' + value.message;
  else {
    try { s = JSON.stringify(value); } catch (e) { s = String(value); }
    if (s === undefined) s = String(value);
  }
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** "12:03:44.120 WARN  player  text" */
export function formatEntry(entry) {
  const d = new Date(entry.t);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const time = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + pad(d.getMilliseconds(), 3);
  return time + ' ' + entry.level.toUpperCase().padEnd(5) + ' ' + entry.tag.padEnd(8) + ' ' + entry.msg;
}

export function createLogger({ capacity = 200, now = Date.now, echo = null } = {}) {
  let entries = [];
  const listeners = new Set();
  const logger = {};

  function add(level, tag, msg, data) {
    const entry = { t: now(), level, tag: String(tag), msg: stringify(msg) + (data === undefined ? '' : ' ' + stringify(data)) };
    entries.push(entry);
    if (entries.length > capacity) entries = entries.slice(entries.length - capacity);
    if (echo) { try { echo(level, entry); } catch (e) { /* a broken console must not break the app */ } }
    listeners.forEach((fn) => { try { fn(entry); } catch (e) { /* same */ } });
    return entry;
  }

  LEVELS.forEach((level) => { logger[level] = (tag, msg, data) => add(level, tag, msg, data); });
  logger.lines = () => entries.slice();
  logger.errors = (n = 20) => entries.filter((e) => e.level === 'error' || e.level === 'warn').slice(-n);
  logger.text = () => entries.map(formatEntry).join('\n');
  logger.clear = () => { entries = []; };
  logger.subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  logger.capacity = capacity;
  return logger;
}

/** Sends uncaught errors and rejected promises to the log. Returns a function that removes the handlers. */
export function installGlobalHandlers(win, logger) {
  const onError = (e) => logger.error('window', (e.message || 'error') + (e.filename ? ' @' + e.filename.split('/').pop() + ':' + e.lineno : ''));
  const onRejection = (e) => logger.error('promise', e.reason == null ? 'unhandled rejection' : e.reason);
  win.addEventListener('error', onError);
  win.addEventListener('unhandledrejection', onRejection);
  return () => { win.removeEventListener('error', onError); win.removeEventListener('unhandledrejection', onRejection); };
}

/** The app's logger. Echoes to the console, which is what the Playwright runs and a TV's web inspector show. */
export const log = createLogger({
  echo: (level, entry) => {
    if (typeof console === 'undefined') return;
    const fn = console[level] || console.log;
    fn.call(console, '[' + entry.tag + '] ' + entry.msg);
  },
});
