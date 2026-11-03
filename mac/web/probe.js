// What this web view can do, as text to copy back from the Air. Read by T7 (CORS, WebKit version) and 1.2 (port).
// JS list: what Alder-tizen's compat-check forbade on Chromium 69, so what the port may now use (R0-001).
// CSS list: judgement, Alder's stylesheets are not in this repo until 1.2; backdrop-filter is from R0-002.
// Sends no auth key and no link. runProbe(win, phase): phase 1 or 2 adds the localStorage line.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AlderProbe = factory();
})(this, function () {
  'use strict';

  var JS_FEATURES = {
    'Promise.allSettled': function (w) { return typeof w.Promise.allSettled === 'function'; },
    'Promise.any': function (w) { return typeof w.Promise.any === 'function'; },
    'Object.fromEntries': function (w) { return typeof w.Object.fromEntries === 'function'; },
    'Object.hasOwn': function (w) { return typeof w.Object.hasOwn === 'function'; },
    'String.replaceAll': function (w) { return typeof w.String.prototype.replaceAll === 'function'; },
    'String.matchAll': function (w) { return typeof w.String.prototype.matchAll === 'function'; },
    'Array.at': function (w) { return typeof w.Array.prototype.at === 'function'; },
    'Array.findLast': function (w) { return typeof w.Array.prototype.findLast === 'function'; },
    'Array.toSorted': function (w) { return typeof w.Array.prototype.toSorted === 'function'; },
    structuredClone: function (w) { return typeof w.structuredClone === 'function'; },
    globalThis: function (w) { return typeof w.globalThis === 'object'; },
    WeakRef: function (w) { return typeof w.WeakRef === 'function'; }
  };
  var CSS_FEATURES = [
    'display: grid',
    'position: sticky',
    'aspect-ratio: 16 / 9',
    'inset: 0',
    'backdrop-filter: blur(4px)',
    '-webkit-backdrop-filter: blur(4px)',
    'selector(:focus-visible)'
  ];
  // POST with a JSON body is the shape Alder's API calls take (R0-001 stremio.js), so it draws the same preflight.
  // No auth key: a refusal from the API still proves the request got through, which is the question here.
  var TARGETS = [
    { name: 'api.strem.io', url: 'https://api.strem.io/api/addonCollectionGet',
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' } },
    { name: 'link.stremio.com', url: 'https://link.stremio.com/api/v2/', init: { method: 'GET' } },
    { name: 'Cinemeta', url: 'https://v3-cinemeta.strem.io/manifest.json', init: { method: 'GET' } },
    { name: 'OpenSubtitles v3', url: 'https://opensubtitles-v3.strem.io/manifest.json', init: { method: 'GET' } },
    { name: 'Torrentio', url: 'https://torrentio.strem.fun/manifest.json', init: { method: 'GET' } }
  ];
  var STORE_KEY = 'alder-probe';
  var STORE_VALUE = 'kept-across-launches';

  // Phase 1 writes a value, phase 2 (a fresh launch) says whether it is still there. No phase: line left out.
  function probeStorage(win, phase) {
    if (!phase) return null;
    try {
      if (phase === 1) {
        win.localStorage.setItem(STORE_KEY, STORE_VALUE);
        return 'localStorage: written';
      }
      var got = win.localStorage.getItem(STORE_KEY);
      return 'localStorage after relaunch: ' + (got === STORE_VALUE ? 'present' : 'missing');
    } catch (err) {
      return 'localStorage: FAILED (' + err.name + ')';
    }
  }

  function engineVersions(ua) {
    var webkit = /AppleWebKit\/([0-9.]+)/.exec(ua);
    var safari = /Version\/([0-9.]+)/.exec(ua);
    return ['WebKit version: ' + (webkit ? webkit[1] : 'unknown'), 'Safari version: ' + (safari ? safari[1] : 'unknown')];
  }

  async function probeTarget(fetchFn, target) {
    try {
      var res = await fetchFn(target.url, target.init);
      return target.name + ': reached, status ' + res.status;
    } catch (err) {
      // Blocked or offline look alike to fetch. no-cors succeeds only when the network path works, so CORS is the cause.
      var verdict = 'network failure or offline';
      try {
        await fetchFn(target.url, { method: 'GET', mode: 'no-cors' });
        verdict = 'blocked by CORS, host reachable';
      } catch (_) { /* verdict stands */ }
      return target.name + ': FAILED, ' + verdict + ' (' + err.name + ': ' + err.message + ')';
    }
  }

  async function runProbe(win, phase) {
    var lines = ['userAgent: ' + win.navigator.userAgent].concat(engineVersions(win.navigator.userAgent));
    lines.push('origin: ' + (win.location ? win.location.origin : 'unavailable'));
    Object.keys(JS_FEATURES).forEach(function (name) {
      lines.push('js ' + name + ': ' + (JS_FEATURES[name](win) ? 'yes' : 'no'));
    });
    CSS_FEATURES.forEach(function (rule) {
      var verdict = win.CSS && win.CSS.supports ? (win.CSS.supports(rule) ? 'yes' : 'no') : 'unavailable';
      lines.push('css ' + rule + ': ' + verdict);
    });
    var store = probeStorage(win, phase);
    if (store) lines.push(store);
    for (var i = 0; i < TARGETS.length; i++) {
      lines.push(await probeTarget(win.fetch.bind(win), TARGETS[i]));
    }
    return lines.join('\n');
  }

  return { runProbe: runProbe, TARGETS: TARGETS };
});
