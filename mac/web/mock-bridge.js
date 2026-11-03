// Stand-in for the Swift side of the bridge (see bridge.js for the contract). Same object shape as native, so
// the page and the tests run without a Mac. Modelled on Alder-tizen's dev/mock-tizen.js: injected clock, a record
// of what crossed. Messages cross as JSON in both directions, as they do on the real boundary.
// Scripted mpv: load -> fileLoaded -> playbackRestart -> time-pos ticks -> endFile eof|error, a track-list, cache
// stalls (paused-for-cache), and the native lifecycle events (sleep, wake, audioDevice, willQuit) on test hooks.
// options.script(url, n) -> null | { fail: 'endFile error text' (load fails at once), freeze (time-pos never advances), failAt: seconds,
// failMessage, duration, res: [w, h], hang (the load never answers: no fileLoaded, no playbackRestart) }: what the n-th load of this url does, for tests that drive the player layer through the bridge.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AlderMockBridge = factory();
})(this, function () {
  'use strict';

  var REPLY_DELAY_MS = { load: 40, seek: 30 }; // the rest reply at DEFAULT, so replies can overtake
  var DEFAULT_REPLY_DELAY_MS = 5;
  var TICK_MS = 250;
  var LOAD_ERROR = -13; // MPV_ERROR_LOADING_FAILED, general knowledge: confirm against client.h in T6
  var SETTABLE = ['aid', 'sid', 'sub-visibility', 'panscan', 'video-aspect-override', 'volume'];
  var OBSERVABLE = ['time-pos', 'duration', 'pause', 'paused-for-cache', 'cache-buffering-state', 'track-list', 'aid',
    'sid', 'hwdec-current', 'video-params', 'audio-params', 'eof-reached'];
  var DEFAULT_OBSERVED = ['time-pos', 'duration', 'pause'];

  // The one strip function (same rule as Swift stripURLs): scheme://... and ?query never leave the shell.
  function stripUrls(text) {
    return String(text).replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*/gi, '[link]').replace(/\?[^\s"'<>]+/g, '?[query]');
  }

  function sanitizeName(name) {
    var n = String(name).replace(/[\/\\:\u0000-\u001f]/g, '_').replace(/^\.+/, '').slice(0, 120);
    return n || 'alder.txt';
  }

  var realClock = {
    after: function (ms, fn) { var t = setTimeout(fn, ms); return function () { clearTimeout(t); }; },
    every: function (ms, fn) { var t = setInterval(fn, ms); return function () { clearInterval(t); }; }
  };

  function installMock(options) {
    var win = options.win;
    var clock = options.clock || realClock;
    var log = options.log || function () {};
    var duration = options.duration || 120;
    var props = {
      'time-pos': null, pause: false, duration: null, 'hwdec-current': 'mock', 'paused-for-cache': false,
      'cache-buffering-state': null, 'eof-reached': null, 'track-list': [], aid: null, sid: null,
      'video-params': null, 'audio-params': null, 'sub-visibility': true, panscan: 0, 'video-aspect-override': -1,
      volume: 100, 'frame-drop-count': 0, 'decoder-frame-drop-count': 0, 'vo-delayed-frame-count': 0,
      'mistimed-frame-count': 0
    };
    var observed = DEFAULT_OBSERVED.slice();
    var failNext = null; // message of the next load error, or null
    var failAtSecond = null;
    var failMessage = 'playback failed';
    var frozen = false;
    var loadDuration = duration;
    var loadCount = 0;
    var loadRes = [1920, 1080];
    var loadTracks = null;
    var stopTicks = null;
    var mock = {
      posted: [], delivered: [], logs: [], reports: [], saved: [], subs: [], loads: [], loadLog: [],
      fullscreen: false, quit: false
    };

    function emit(event) {
      var wire = JSON.parse(JSON.stringify(event));
      mock.delivered.push(wire);
      if (win.alderNative) win.alderNative.onEvent(wire);
    }

    function setProp(name, value) {
      props[name] = value;
      if (observed.indexOf(name) >= 0) emit({ type: 'prop', name: name, value: value });
    }

    function defaultTracks() {
      return loadTracks || options.tracks || [
        { type: 'video', id: 1, codec: 'h264', selected: true, 'demux-w': loadRes[0], 'demux-h': loadRes[1], 'demux-fps': 24 },
        { type: 'audio', id: 1, lang: 'eng', title: 'English', codec: 'aac', 'audio-channels': 2, selected: true },
        { type: 'audio', id: 2, lang: 'fra', title: 'French', codec: 'ac3', 'audio-channels': 6, selected: false }
      ];
    }

    function pickTrack(type, id) {
      var list = props['track-list'].map(function (t) {
        return t.type === type ? Object.assign({}, t, { selected: t.id === id }) : t;
      });
      setProp('track-list', list);
    }

    function endPlayback(reason, extra) {
      if (stopTicks) { stopTicks(); stopTicks = null; }
      props['time-pos'] = null;
      if (extra && extra.message !== undefined) extra.message = stripUrls(extra.message);
      emit(Object.assign({ type: 'endFile', reason: reason }, extra));
    }

    function tick() {
      if (props.pause || props['paused-for-cache'] || frozen) return;
      var next = props['time-pos'] + TICK_MS / 1000;
      if (failAtSecond !== null && next >= failAtSecond) {
        failAtSecond = null;
        endPlayback('error', { error: LOAD_ERROR, message: failMessage });
      } else if (next >= loadDuration) {
        setProp('time-pos', loadDuration);
        setProp('eof-reached', true);
        endPlayback('eof');
      } else {
        setProp('time-pos', next);
      }
    }

    function startLoad(args, arrived) {
      if (stopTicks) endPlayback('stop');
      mock.loads.push({ headers: args.headers || {}, start: args.start || 0 });
      mock.loadLog.push({ url: args.url, at: arrived }); // for the player-layer tests: which link, when the command arrived
      var spec = (options.script && options.script(args.url, ++loadCount)) || {};
      frozen = !!spec.freeze;
      loadDuration = spec.duration || duration;
      loadRes = spec.res || [1920, 1080];
      loadTracks = spec.tracks || null; // mpv track-list entries for this load (DTS, TrueHD, text tracks ...)
      failMessage = spec.failMessage || 'playback failed';
      if (spec.failAt !== undefined) failAtSecond = spec.failAt;
      if (spec.fail !== undefined && failNext === null) failNext = spec.fail;
      if (failNext !== null) {
        var message = failNext;
        failNext = null;
        endPlayback('error', { error: LOAD_ERROR, message: message });
        return;
      }
      if (spec.hang) return;
      emit({ type: 'fileLoaded' });
      setProp('duration', loadDuration);
      setProp('pause', false);
      setProp('paused-for-cache', false);
      setProp('cache-buffering-state', 100);
      setProp('eof-reached', false);
      props['track-list'] = defaultTracks();
      setProp('track-list', props['track-list']);
      var picked = function (type) { var t = props['track-list'].filter(function (x) { return x.type === type && x.selected; })[0]; return t ? t.id : null; };
      setProp('aid', picked('audio'));
      setProp('sid', picked('sub'));
      setProp('video-params', { w: loadRes[0], h: loadRes[1], pixelformat: 'yuv420p' });
      setProp('audio-params', { samplerate: 48000, 'channel-count': 2 });
      setProp('time-pos', args.start || 0);
      emit({ type: 'playbackRestart' });
      stopTicks = clock.every(TICK_MS, tick);
    }

    var actions = {
      load: function (args, arrived) {
        if (typeof args.url !== 'string' || !args.url) throw new Error('load needs url');
        if (args.headers !== undefined && (typeof args.headers !== 'object' || args.headers === null)) {
          throw new Error('load headers must be an object');
        }
        return { after: function () { startLoad(args, arrived); } };
      },
      observe: function (args) {
        if (!Array.isArray(args.names) || !args.names.length) throw new Error('observe needs names');
        args.names.forEach(function (n) { if (OBSERVABLE.indexOf(n) < 0) throw new Error('property not observable'); });
        return {
          after: function () {
            args.names.forEach(function (n) {
              if (observed.indexOf(n) < 0) observed.push(n);
              emit({ type: 'prop', name: n, value: props[n] }); // mpv sends the current value on observe
            });
          }
        };
      },
      pause: function (args) { return { after: function () { setProp('pause', !!args.paused); } }; },
      seek: function (args) {
        if (typeof args.seconds !== 'number' || !isFinite(args.seconds)) throw new Error('seek needs seconds');
        if (!stopTicks) throw new Error('nothing playing');
        return {
          after: function () {
            setProp('time-pos', Math.max(0, Math.min(loadDuration, args.seconds)));
            emit({ type: 'playbackRestart' });
          }
        };
      },
      setProp: function (args) {
        if (SETTABLE.indexOf(args.name) < 0) throw new Error('property not settable');
        if (args.value === undefined) throw new Error('setProp needs name and value');
        return {
          after: function () {
            setProp(args.name, args.value);
            if (args.name === 'aid' && typeof args.value === 'number') pickTrack('audio', args.value);
            if (args.name === 'sid' && typeof args.value === 'number') pickTrack('sub', args.value);
          }
        };
      },
      getProp: function (args) {
        if (!Object.prototype.hasOwnProperty.call(props, args.name) || props[args.name] === null) {
          throw new Error('property unavailable');
        }
        return { value: props[args.name] };
      },
      subAdd: function (args) {
        if (typeof args.text !== 'string' || !args.text) throw new Error('subAdd needs text');
        if (!stopTicks) throw new Error('nothing playing');
        return {
          after: function () {
            var id = props['track-list'].filter(function (t) { return t.type === 'sub'; }).length + 1;
            mock.subs.push({ text: args.text, lang: args.lang || '', title: args.title || '' });
            props['track-list'] = props['track-list'].concat([{
              type: 'sub', id: id, lang: args.lang || '', title: args.title || '', codec: 'subrip',
              external: true, selected: false
            }]);
            pickTrack('sub', id);
            setProp('sid', id);
          }
        };
      },
      fullscreen: function (args) {
        mock.fullscreen = !!args.on;
        return {};
      },
      saveFile: function (args) {
        if (typeof args.name !== 'string' || typeof args.text !== 'string') throw new Error('saveFile needs name and text');
        var name = sanitizeName(args.name);
        mock.saved.push({ name: name, text: args.text });
        return { value: '~/Downloads/' + name };
      },
      log: function (args) {
        if (typeof args.line !== 'string') throw new Error('log needs line');
        mock.logs.push(stripUrls(args.line));
        return {};
      },
      report: function (args) {
        if (typeof args.text !== 'string') throw new Error('report needs text');
        mock.reports.push(stripUrls(args.text));
        return {};
      },
      quit: function () {
        return { after: function () { mock.quit = true; if (stopTicks) endPlayback('quit'); } };
      }
    };

    win.webkit = win.webkit || {};
    win.webkit.messageHandlers = win.webkit.messageHandlers || {};
    win.webkit.messageHandlers.alder = {
      postMessage: function (message) {
        var msg = JSON.parse(JSON.stringify(message));
        mock.posted.push(msg);
        log('mock got ' + msg.id + ' ' + msg.cmd); // never args: load carries the link
        var delay = REPLY_DELAY_MS[msg.cmd] || DEFAULT_REPLY_DELAY_MS;
        var arrived = clock.now ? clock.now() : 0;
        clock.after(delay, function () {
          var result;
          try {
            if (!Object.prototype.hasOwnProperty.call(actions, msg.cmd)) throw new Error('unknown command');
            result = actions[msg.cmd](msg.args || {}, arrived);
          } catch (err) {
            emit({ type: 'reply', id: msg.id, ok: false, error: err.message });
            return;
          }
          var reply = { type: 'reply', id: msg.id, ok: true };
          if (result.value !== undefined) reply.value = result.value;
          emit(reply);
          if (result.after) result.after();
        });
      }
    };

    mock.failNextLoad = function (message) { failNext = message || 'loading failed'; };
    mock.failNow = function (message) { if (stopTicks) endPlayback('error', { error: LOAD_ERROR, message: message || 'playback failed' }); }; // a playback error now
    mock.prop = function (name) { return props[name]; }; // what mpv holds now (panscan, pause, ...)
    mock.failAt = function (seconds) { failAtSecond = seconds; }; // a playback error after that second
    // A cache stall: paused-for-cache for ms, as mpv does when the demuxer runs dry.
    mock.stall = function (ms) {
      setProp('paused-for-cache', true);
      setProp('cache-buffering-state', 0);
      clock.after(ms, function () {
        setProp('paused-for-cache', false);
        setProp('cache-buffering-state', 100);
      });
    };
    // Native lifecycle: the shell pauses mpv first on sleep, then emits.
    mock.sleep = function () { if (stopTicks) setProp('pause', true); emit({ type: 'sleep' }); };
    mock.wake = function () { emit({ type: 'wake' }); };
    mock.audioDeviceChanged = function () { emit({ type: 'audioDevice' }); };
    mock.requestQuit = function () { emit({ type: 'willQuit' }); }; // Cmd-Q or window close
    mock.emitRaw = emit; // test hook: what a buggy native could send
    return mock;
  }

  return { installMock: installMock, stripUrls: stripUrls };
});
