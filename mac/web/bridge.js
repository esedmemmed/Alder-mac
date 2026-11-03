// Page side of the Alder bridge. Classic script + CommonJS, so it runs from file://, the app scheme and node --test.
// JS to native: window.webkit.messageHandlers.alder.postMessage({id, cmd, args})
// Native to JS: window.alderNative.onEvent({type, ...})
// Args:   load {url, headers?, start?} · pause {paused} · seek {seconds} · observe {names} · setProp {name, value}
//         getProp {name} · subAdd {text, lang?, title?} · fullscreen {on} · saveFile {name, text} · quit {}
//         log {line} · report {text}  (text for the shell's --report file; scrubbed of links like everything else)
// Events: reply {id, ok, value|error} · prop {name, value} · fileLoaded · playbackRestart
//         endFile {reason: eof|stop|quit|error|redirect, error?: mpv error code, message?}
//         sleep · wake · audioDevice · willQuit        (full wire: docs/ops/INDEX.md, Bridge v2 wire)
// Events never carry the link. Native must not send one; scrubbing here is the second line, not the contract.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AlderBridge = factory();
})(this, function () {
  'use strict';

  var COMMANDS = ['load', 'pause', 'seek', 'setProp', 'getProp', 'quit', 'log', 'report',
    'observe', 'subAdd', 'fullscreen', 'saveFile'];
  var EVENT_TYPES = ['reply', 'prop', 'fileLoaded', 'playbackRestart', 'endFile',
    'sleep', 'wake', 'audioDevice', 'willQuit'];
  var LINK_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*|\bmagnet:\?[^\s"'<>]*/gi;
  var REDACTED = '[link]';

  function scrubText(text, known) {
    var out = text;
    known.forEach(function (link) { out = out.split(link).join(REDACTED); });
    return out.replace(LINK_RE, REDACTED);
  }

  function scrub(value, known) {
    if (typeof value === 'string') return scrubText(value, known);
    if (Array.isArray(value)) return value.map(function (v) { return scrub(v, known); });
    if (value && typeof value === 'object') {
      var out = {};
      Object.keys(value).forEach(function (k) { out[k] = scrub(value[k], known); });
      return out;
    }
    return value;
  }

  function createBridge(options) {
    var win = options.win;
    var log = options.log || function () {};
    var nextId = 1;
    var pending = new Map();
    var listeners = new Map();
    var known = []; // links handed to load, plus their encoded form; memory only

    function safeLog(line) { log(scrubText(line, known)); }

    function deliver(type, event) {
      (listeners.get(type) || []).slice().forEach(function (fn) {
        try { fn(event); } catch (err) { safeLog('listener failed on ' + type + ': ' + err.message); }
      });
    }

    function onEvent(raw) {
      if (!raw || EVENT_TYPES.indexOf(raw.type) < 0) {
        safeLog('dropped event of unknown type');
        return;
      }
      var event = scrub(raw, known);
      if (event.type === 'reply') {
        var call = pending.get(event.id);
        if (!call) { safeLog('dropped reply for unknown id ' + event.id); return; }
        pending.delete(event.id);
        safeLog('<- ' + event.id + ' ' + call.cmd + (event.ok ? ' ok' : ' failed: ' + event.error));
        if (event.ok) call.resolve(event.value);
        else call.reject(new Error(String(event.error)));
      } else if (event.type !== 'prop') { // prop runs many times a second: no log line
        safeLog('event ' + event.type + (event.reason ? ' ' + event.reason : '') +
          (event.message ? ': ' + event.message : ''));
      }
      deliver(event.type, event);
    }

    function send(cmd, args) {
      if (COMMANDS.indexOf(cmd) < 0) return Promise.reject(new Error('unknown command ' + cmd));
      var handler = win.webkit && win.webkit.messageHandlers && win.webkit.messageHandlers.alder;
      if (!handler) return Promise.reject(new Error('native bridge not present'));
      var id = nextId++;
      safeLog('-> ' + id + ' ' + cmd); // args never logged: load carries the link
      return new Promise(function (resolve, reject) {
        pending.set(id, { cmd: cmd, resolve: resolve, reject: reject });
        handler.postMessage({ id: id, cmd: cmd, args: args || {} });
      });
    }

    win.alderNative = { onEvent: onEvent };

    return {
      send: send,
      on: function (type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
        return function () {
          var list = listeners.get(type);
          list.splice(list.indexOf(fn), 1);
        };
      },
      pendingCount: function () { return pending.size; },
      load: function (url, opts) {
        if (typeof url !== 'string' || !url) return Promise.reject(new Error('load needs a link'));
        var args = { url: url };
        if (opts && opts.headers && typeof opts.headers === 'object') {
          args.headers = opts.headers;
          Object.keys(opts.headers).forEach(function (k) {
            var v = String(opts.headers[k]);
            if (v.length >= 8 && known.indexOf(v) < 0) known.push(v); // tokens too; short values would shred logs
          });
        }
        if (opts && typeof opts.start === 'number' && opts.start > 0) args.start = opts.start;
        [url, encodeURIComponent(url)].forEach(function (form) {
          if (known.indexOf(form) < 0) known.push(form);
        });
        return send('load', args);
      },
      observe: function (names) { return send('observe', { names: names }); },
      subAdd: function (text, lang, title) { return send('subAdd', { text: text, lang: lang || '', title: title || '' }); },
      fullscreen: function (on) { return send('fullscreen', { on: !!on }); },
      saveFile: function (name, text) { return send('saveFile', { name: name, text: text }); },
      pause: function (paused) { return send('pause', { paused: !!paused }); },
      seek: function (seconds) { return send('seek', { seconds: seconds }); },
      setProp: function (name, value) { return send('setProp', { name: name, value: value }); },
      getProp: function (name) { return send('getProp', { name: name }); },
      quit: function () { return send('quit', {}); },
      log: function (line) { return send('log', { line: scrubText(String(line), known) }); },
      report: function (text) { return send('report', { text: scrubText(String(text), known) }); }
    };
  }

  return { createBridge: createBridge, COMMANDS: COMMANDS, EVENT_TYPES: EVENT_TYPES };
});
