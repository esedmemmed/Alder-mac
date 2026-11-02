// Stand-in for the Swift side of the bridge (see bridge.js for the contract). Same object shape as native, so
// the page and the tests run without a Mac. Modelled on Alder-tizen's dev/mock-tizen.js: injected clock, a record
// of what crossed. Messages cross as JSON in both directions, as they do on the real boundary.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AlderMockBridge = factory();
})(this, function () {
  'use strict';

  var REPLY_DELAY_MS = { load: 40, seek: 30 }; // the rest reply at DEFAULT, so replies can overtake
  var DEFAULT_REPLY_DELAY_MS = 5;
  var TICK_MS = 250;
  var LOAD_ERROR = -13; // MPV_ERROR_LOADING_FAILED, general knowledge: confirm against client.h in T6

  var realClock = {
    after: function (ms, fn) { var t = setTimeout(fn, ms); return function () { clearTimeout(t); }; },
    every: function (ms, fn) { var t = setInterval(fn, ms); return function () { clearInterval(t); }; }
  };

  function installMock(options) {
    var win = options.win;
    var clock = options.clock || realClock;
    var log = options.log || function () {};
    var duration = options.duration || 120;
    var props = { 'time-pos': null, pause: false, duration: null, 'hwdec-current': 'mock' };
    var failNext = false;
    var stopTicks = null;
    var mock = { posted: [], delivered: [] };

    function emit(event) {
      var wire = JSON.parse(JSON.stringify(event));
      mock.delivered.push(wire);
      if (win.alderNative) win.alderNative.onEvent(wire);
    }

    function setProp(name, value) {
      props[name] = value;
      emit({ type: 'prop', name: name, value: value });
    }

    function endPlayback(reason, extra) {
      if (stopTicks) { stopTicks(); stopTicks = null; }
      props['time-pos'] = null;
      emit(Object.assign({ type: 'endFile', reason: reason }, extra));
    }

    function tick() {
      if (props.pause) return;
      var next = props['time-pos'] + TICK_MS / 1000;
      if (next >= duration) {
        setProp('time-pos', duration);
        endPlayback('eof');
      } else {
        setProp('time-pos', next);
      }
    }

    function startLoad() {
      if (stopTicks) endPlayback('stop');
      if (failNext) {
        failNext = false;
        endPlayback('error', { error: LOAD_ERROR, message: 'loading failed' });
        return;
      }
      emit({ type: 'fileLoaded' });
      setProp('duration', duration);
      setProp('pause', false);
      setProp('time-pos', 0);
      emit({ type: 'playbackRestart' });
      stopTicks = clock.every(TICK_MS, tick);
    }

    var actions = {
      load: function (args) {
        if (typeof args.url !== 'string' || !args.url) throw new Error('load needs url');
        return { after: startLoad };
      },
      pause: function (args) { return { after: function () { setProp('pause', !!args.paused); } }; },
      seek: function (args) {
        if (typeof args.seconds !== 'number' || !isFinite(args.seconds)) throw new Error('seek needs seconds');
        if (!stopTicks) throw new Error('nothing playing');
        return {
          after: function () {
            setProp('time-pos', Math.max(0, Math.min(duration, args.seconds)));
            emit({ type: 'playbackRestart' });
          }
        };
      },
      setProp: function (args) { return { after: function () { setProp(args.name, args.value); } }; },
      getProp: function (args) {
        if (!(args.name in props)) throw new Error('property unavailable');
        return { value: props[args.name] };
      },
      quit: function () { return { after: function () { if (stopTicks) endPlayback('quit'); } }; }
    };

    win.webkit = win.webkit || {};
    win.webkit.messageHandlers = win.webkit.messageHandlers || {};
    win.webkit.messageHandlers.alder = {
      postMessage: function (message) {
        var msg = JSON.parse(JSON.stringify(message));
        mock.posted.push(msg);
        log('mock got ' + msg.id + ' ' + msg.cmd); // never args: load carries the link
        var delay = REPLY_DELAY_MS[msg.cmd] || DEFAULT_REPLY_DELAY_MS;
        clock.after(delay, function () {
          var result;
          try {
            if (!Object.prototype.hasOwnProperty.call(actions, msg.cmd)) throw new Error('unknown command');
            result = actions[msg.cmd](msg.args || {});
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

    mock.failNextLoad = function () { failNext = true; };
    mock.emitRaw = emit; // test hook: what a buggy native could send
    return mock;
  }

  return { installMock: installMock };
});
