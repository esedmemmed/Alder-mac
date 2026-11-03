/*
 * The player's state machine: a port of the logic of Alder's PlayerActivity.kt, with Samsung's AVPlay in place of ExoPlayer
 * and every view taken out. It knows nothing of the DOM: it talks to AVPlay through player/avplay.js, to Stremio through
 * core/library.js and core/stremio.js, and to whatever draws it through events, so it runs in Node against the AVPlay mock
 * and a fake clock (test/player/).
 *
 * Alder's comments, adapted: the player gets a short list of sources (TRY of them from core/ranking.js). One that fails, or
 * has not shown a picture after START_WAIT, gives way to the next at the same second, and when the list runs out the
 * sources page opens (the 'navigate' event; src/app/navigation.js shows it). Network blips are retried first, twice after 1.5 s
 * (NuvioTV's rule), so a dropped connection does not cost the source. Resumes where Stremio says you stopped and writes
 * progress back to the account, so Continue Watching matches on every device.
 *
 * Picture (v0.2, docs/DECISIONS.md "Picture size"): the video's shape is read from the VIDEO track once AVPlay has prepared, and
 * the viewer's Fit / Fill choice (Settings' per-profile default, changeable in the options panel and then remembered) is
 * handed to avplay.setPicture() before play and again whenever it changes: at once, no reload.
 *
 * Tizen additions (PLAN.md section 5, Stage B): after AVPlay has prepared, the audio tracks are read and the best
 * *playable* one is selected before play (core/audio.js decideAudio); a file with nothing this TV can decode is a failed
 * source ("no playable audio"); an audio decode error mid-film moves to the next track at the same second.
 *
 * ---- use ----
 *   const engine = createEngine(params, deps)
 *   engine.on('loading', fn) ...            returns a function that removes the listener
 *   engine.start()
 *
 * params (Alder's intent extras): type, metaId, videoId, name, poster, background, logo, episode ("S1 E4  ·  Title"),
 *   sources (core/addon.js Stream objects or their toJson()), resumeAt (ms, optional), startOver, picked (the viewer chose
 *   this source: no automatic fall back to the sources page), nextVideoId, runtime.
 * deps: avplay (player/avplay.js), clock ({ now, setTimeout, clearTimeout }), stremio + authKey, library (core/library.js
 *   createLibrary), settings (core/settings.js), memory (core/ranking.js createSourceMemory), device (core/device.js profile),
 *   http ({ get(url) -> Promise<string> }), log (lib/log.js logger), diag (player/diag.js), tvLanguage () => "en",
 *   audioLanguage () => "en" (default: settings.audioLanguage()), loadMeta (type, metaId) => Promise<Meta|null> (default: the account's
 *   meta add-on), resolveUrl (stream) => url | Promise<url> (default: player/sources.js).
 *
 * ---- events ----
 *   loading        { visible, message }        the loading overlay ("Starting · 2160p · Torrentio", "That source failed ...")
 *   started        { source }                  a picture shows
 *   playing        { playing }                 play / pause changed
 *   scrub          { position }                the playing point moved on the bar (the seek itself waits for SEEK_SETTLE)
 *   meta           { }                         the episode list arrived: title, subtitle and "Next episode" may have changed
 *   tracks         { }                         audio / subtitle choices changed (options panel)
 *   picture        { ...pictureInfo() }        Fit / Fill changed, or the video's shape became known (options panel)
 *   subtitle       { lines | null }            what the subtitle overlay draws (lines as core cueLines)
 *   skip           { visible, label }          the Skip intro / recap pill
 *   upNext         { video } / upNextHide      the Up next card
 *   stall          { height, lower, position } / stallHide     the "Keeps buffering: switch to 1080p?" offer
 *   sourceError    { }                         every source failed and the viewer had picked this one: "Try another source"
 *   notice         { message }                 a short message (a toast)
 *   navigate       { kind, ... }               the player is done, go here:
 *                    exit                                    back to where we came from
 *                    sources { pick, resumeAt, maxHeight, message }   the sources page (Change stream, lower quality, all failed)
 *                    next { video, afterVideoId }            start the next episode (through the sources page)
 *                    details                                 the title page
 */
import { PLAYER, lowerSourceHeight, upNextWindow, plausibleEpisode, nextVideo as nextVideoIn, chooseAddonSubtitles, parseSegments, introDbUrl } from '../core/playback.js';
import { parseAudioTracks, decideAudio, afterAudioError, describeTracks } from '../core/audio.js';
import { Stream, runtime } from '../core/addon.js';
import { toIso1 } from '../core/lang.js';
import { errorCode } from './avplay.js';
import { parseTextTracks, startSubtitle } from './tracks.js';
import { parseSubtitles, shiftCues, cueAt, cueLines } from './subtitles.js';
import { resolvePlayableUrl } from './sources.js';
import { PICTURE, PICTURE_NAMES, normalisePicture, parseVideoShape, shapeText, shapeNote, hasBars, cropPercent } from './picture.js';

const { TICK, PUSH_EVERY, RESUME_SLACK, SKIP_SHOWN, START_WAIT, RETRIES, RETRY_WAIT, SEEK_SETTLE, STALL_WINDOW, STALLS_FOR_LOWER } = PLAYER;

export const CHECK_EVERY = 500; // the Skip intro / Up next check (Alder's skipTask)
const SEEK_GRACE = 2000; // a buffering this soon after a seek is the seek, not a stall
const SEEK_WAIT = 2500; // how long the resume seek may take before play() goes ahead without waiting for it
const PICTURE_MS = 500; // playback time must advance this far past the start (or on two reports in a row) to count as a picture
const SUBTITLE_EVERY = 250; // how often an add-on subtitle is matched to the playing time

/**
 * Worth trying the same link again: a network or server hiccup, not a link that is gone (4xx) or a bad file
 * (Alder: error codes 2000..2999 except HTTP 4xx other than 408 and 429). AVPlay's names: only CONNECTION_FAILED is a
 * network failure; the HTTP status, when AVPlay reports it (PLAYER_MSG_HTTP_ERROR_CODE), tells a dead link from a blip.
 */
export function isRetryable(code, httpStatus = 0) {
  if (code !== 'PLAYER_ERROR_CONNECTION_FAILED') return false;
  if (httpStatus >= 400 && httpStatus <= 499) return httpStatus === 408 || httpStatus === 429;
  return true;
}

/** A decode error, as opposed to a network one or a bad link: the audio track in use is the first suspect (Alder: rendererFormat). */
export function isDecodeError(code) {
  return code === 'PLAYER_ERROR_NOT_SUPPORTED_FORMAT';
}

const toStream = (s) => (s instanceof Stream ? s : Stream.read(s));

export function createEngine(params, deps) {
  const { avplay, clock, stremio = null, authKey = null, library, settings, memory = null, device, http = null, log, diag } = deps;
  const resolveUrl = deps.resolveUrl || resolvePlayableUrl;
  const tvLanguage = deps.tvLanguage || (() => 'en');
  const audioLanguage = () => toIso1(deps.audioLanguage ? deps.audioLanguage() : settings.audioLanguage());

  const type = params.type || 'movie';
  const metaId = params.metaId;
  const videoId = params.videoId;
  const sources = (params.sources || []).map(toStream);

  const listeners = {};
  const timers = new Set();
  const say = (msg) => log.info('player', msg);
  const warn = (msg) => log.warn('player', msg);

  // ---- state, named as PlayerActivity names it ----
  let item = null; // the title's library item. Null when it could not be loaded: then nothing is saved, rather than overwriting real history with a blank item
  let lastPosition = 0;
  let ticks = 0;
  let at = 0; // the source playing
  let retries = 0; // network retries on this source
  let started = false; // a picture has shown
  let startMessage = null;
  let watched = false; // any source showed a picture this time: only then is progress saved
  let startAt = 0;
  let prepared = false;
  let meta = null;
  let tickedWatched = false;
  let upNextDismissed = false;
  let upNextVisible = false;
  let offeringLower = false; // the pill's other use: a source that keeps stalling (three times in a minute) is offered a lower quality once
  let stalls = [];
  let seekedAt = -1e9;
  let audioPicked = false;
  let subsPicked = false;
  let failedAudio = new Set(); // indexes of audio tracks that failed to decode
  let scrubTo = -1;
  let segments = [];
  let outroAt = 0;
  let skipShownAt = 0;
  let skipTag = null;
  let skipVisible = false;
  let skipLabel = '';
  const skipped = new Set(); // shown once and left alone, or skipped: not offered again this time

  // ---- state AVPlay needs and ExoPlayer kept for us ----
  let gen = 0; // each open of a source: what arrives from an earlier one is ignored
  let playRequested = false; // play() was called: only then can time advancing mean the picture
  let lastReport = null; // the previous oncurrentplaytime since play(), for "two reports in a row that increase"
  let playing = true; // playWhenReady
  let loading = { visible: false, message: '' };
  let bufferPercent = 0;
  let duration = 0;
  let live = false;
  let lastTime = 0;
  let ended = false;
  let reloadAt = null; // while a retry or an audio change reloads the source: where it was
  let pendingSeek = null;
  let lastHttpStatus = 0;
  let pictureMode = normalisePicture(settings && settings.pictureSize ? settings.pictureSize() : PICTURE.FIT); // what the viewer asked for
  let shape = null; // the video's shape (picture.js parseVideoShape), null until AVPlay has prepared or when it does not say
  let pictureReady = false; // AVPlay has prepared this session: the choice can be applied now
  let pictureApplied = null; // what avplay.setPicture() answered: { mode, method, roi, reason }, null before the first
  let audioTracks = [];
  let audioIndex = null; // the audio track in use
  let textTracks = [];
  let subMode = 'off'; // 'off' | 'file' | 'addon'
  let textIndex = null;
  let addonSubs = [];
  let chosenSub = null;
  let subCues = null; // the add-on subtitle's cues, as fetched
  let shifted = null; // ... moved by subDelay
  let subDelay = 0;
  let subHint = 0;
  let subShown = null;
  let subChoiceToken = 0;
  let controlsShown = false;
  let suspended = false;
  let finished = false;
  let shut = false;
  let startTimer = null;
  let tickTimer = null;
  let skipTimer = null;
  let seekTimer = null;
  let subsTimer = null;
  let fileSubTimer = null;

  // ---- plumbing ----
  const api = {};
  const after = (fn, ms) => {
    if (shut) return null; // closed: no timer may start again (a late promise or a view still calling in)
    const id = clock.setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  };
  const cancel = (id) => { if (id !== null && id !== undefined) { clock.clearTimeout(id); timers.delete(id); } };
  const emit = (name, data = {}) => {
    (listeners[name] || []).slice().forEach((fn) => { try { fn(data); } catch (e) { warn('listener for ' + name + ' threw: ' + (e && e.message ? e.message : e)); } });
  };
  const decide = (text) => { say(text); if (diag) diag.decision(text); };

  const source = () => sources[at];
  const nextVideo = () => nextVideoIn(meta && meta.videos, videoId);
  const isPlaceholder = () => type === 'series' && !plausibleEpisode(duration);

  /** Where the viewer is: the picture's time once there is one, the second to start from before. */
  function position() {
    if (!started) return startAt;
    if (ended) return duration;
    if (pendingSeek !== null) return pendingSeek;
    if (reloadAt !== null) return reloadAt;
    const t = avplay.time();
    return t === null ? lastTime : t;
  }

  // ---- loading overlay ----
  function loadingMessage() {
    return started ? 'Loading' : startMessage || 'Starting · ' + (source() ? source().label : '');
  }

  function showLoading(message) {
    const pct = message === 'Loading' && bufferPercent >= 1 && bufferPercent <= 99 ? ' · ' + bufferPercent + '%' : '';
    loading = { visible: true, message: message + pct };
    emit('loading', loading);
  }

  function hideLoading() {
    if (!loading.visible && loading.message === '') return;
    loading = { visible: false, message: '' };
    emit('loading', loading);
  }

  // ---- starting a source ----

  /** Plays the current source from [position] with its own request headers (debrid proxies need them). */
  function load(position, message = null) {
    const s = source();
    startAt = position;
    started = false;
    ended = false;
    playRequested = false;
    reloadAt = null;
    pendingSeek = null;
    startMessage = message || 'Starting · ' + s.label;
    showLoading(startMessage);
    cancel(startTimer);
    startTimer = after(onStartTimeout, START_WAIT);
    attempt(position, {});
  }

  function onStartTimeout() {
    startTimer = null;
    if (started) return;
    warn('source ' + (at + 1) + '/' + sources.length + ' timed out');
    next('no picture after ' + START_WAIT / 1000 + ' s');
  }

  /**
   * Opens the current source and gets it to play: open -> prepare -> decide the audio track -> (seek) -> play. Used for a
   * fresh source and again for a retry or an audio change, which resume where the viewer was ([forcedAudio]: the track the
   * viewer or the audio fallback chose, applied instead of deciding).
   */
  async function attempt(position, { forcedAudio = null } = {}) {
    const mine = ++gen;
    const s = source();
    lastHttpStatus = 0;
    bufferPercent = 0;
    playRequested = false; // events of this prepare are not the picture
    pictureReady = false;
    let url;
    try {
      url = await Promise.resolve(resolveUrl(s));
    } catch (e) {
      if (mine !== gen) return;
      warn('could not resolve the source URL: ' + errorCode(e));
      return next('could not resolve the URL');
    }
    if (mine !== gen || shut) return;
    if (diag) diag.setStream({ url, label: s.label, at: at + 1, total: sources.length, headers: Object.keys(s.headers) });
    try {
      avplay.open(url, { headers: s.headers }, handlersFor(mine));
      await avplay.prepare();
    } catch (e) {
      if (mine !== gen || shut) return;
      return onError(errorCode(e));
    }
    if (mine !== gen || shut) return;
    await afterPrepare(mine, position, forcedAudio);
  }

  async function afterPrepare(mine, position, forcedAudio) {
    const total = avplay.duration();
    if (total > 0) duration = total;
    live = avplay.isLive();
    const raw = avplay.totalTracks();
    if (diag) diag.setTracks(raw);
    const current = avplay.currentIndex('AUDIO');
    audioTracks = parseAudioTracks(raw, { currentIndex: current, playable: device.audio });
    textTracks = parseTextTracks(raw);
    readShape(raw);
    say('prepared: ' + (duration / 1000).toFixed(0) + ' s' + (live ? ' (live)' : '') + ', audio [' + describeTracks(audioTracks) + '], ' + textTracks.length + ' text track(s)');

    // Release files carry many dubs; start in the chosen language (the TV's unless Settings says) instead of the first.
    // Once per video, like Alder: picks made later in the options panel stand.
    if (forcedAudio !== null) {
      avplay.selectTrack('AUDIO', forcedAudio);
      audioIndex = forcedAudio;
    } else if (!audioPicked) {
      const decision = decideAudio(audioTracks, { language: audioLanguage(), failed: failedAudio, currentIndex: current });
      decide('audio: ' + decision.reason);
      if (!decision.ok) return next('no playable audio');
      audioPicked = true;
      audioIndex = decision.index !== null ? decision.index : current;
      if (decision.change) avplay.selectTrack('AUDIO', decision.index);
    } else if (audioIndex !== null && audioIndex !== current) {
      avplay.selectTrack('AUDIO', audioIndex);
    }

    // Releases flag foreign subtitles as forced or default: start with subtitles only in the TV's language, else none.
    if (!subsPicked && textTracks.length) {
      subsPicked = true;
      const pick = startSubtitle(textTracks, { enabled: settings.subtitles(), tvLanguage: tvLanguage() });
      if (pick) { subMode = 'file'; textIndex = pick.index; decide('subtitles: started #' + pick.index + ' (' + (pick.language || 'unknown') + ') in the TV language'); }
      else decide('subtitles: none start (' + (settings.subtitles() ? 'no track in the TV language' : 'off in Settings') + ')');
    }
    applySubtitleMode();
    emit('tracks');
    applyPicture();

    // A fresh source starts from startAt (the library's answer may still move it); a reload resumes where it was.
    let from = started ? position : startAt;
    if (duration > 0) from = Math.min(from, Math.max(0, duration - 1000));
    if (from > 0) {
      seekedAt = clock.now();
      try { await Promise.race([avplay.seekTo(from), new Promise((resolve) => after(resolve, SEEK_WAIT))]); } catch (e) { if (!shut) warn('seek to the resume point failed: ' + errorCode(e)); }
      if (mine !== gen || shut) return;
    }
    playRequested = true;
    lastReport = null;
    playing = true;
    avplay.play();
    emit('playing', { playing: true });
  }

  // ---- picture size ----

  /** The video's shape from the track list (or, failing that, the streams AVPlay says are playing). Null when it is not said. */
  function readShape(raw) {
    const current = avplay.currentIndex('VIDEO');
    shape = parseVideoShape(raw, { currentIndex: current }) || parseVideoShape(avplay.currentStreams(), { currentIndex: current });
    decide('picture: source ' + (shape ? shapeText(shape) + (shape.reported === 'none' ? '' : ' (' + shape.reported + ' aspect reported)') : 'size not reported by the TV'));
  }

  /** Hands the viewer's choice to AVPlay for this session (open() starts every session as Fit). */
  function applyPicture() {
    pictureReady = true;
    pictureApplied = avplay.setPicture(pictureMode, shape);
    if (pictureMode === PICTURE.FILL && pictureApplied.mode !== PICTURE.FILL) decide('picture: Fill not applied (' + pictureApplied.reason + '), showing Fit');
    else decide('picture: ' + PICTURE_NAMES[pictureApplied.mode] + ' (' + pictureApplied.method + (pictureApplied.roi ? ', crop ' + pictureApplied.roi.join(',') : '') + ')');
    if (diag) diag.setPicture(pictureInfo());
    emit('picture', pictureInfo());
  }

  /** What the options panel, the Info card and Diagnostics say about the picture. */
  function pictureInfo() {
    const applied = pictureApplied;
    return {
      mode: pictureMode, // asked for
      showing: applied ? applied.mode : PICTURE.FIT, // what is on the screen now
      fillSupported: avplay.fillSupported,
      reason: applied ? applied.reason : '',
      method: applied ? applied.method : '',
      roi: applied ? applied.roi : null,
      shape,
      text: shapeText(shape),
      note: shapeNote(shape),
      bars: hasBars(shape),
      crop: cropPercent(shape),
    };
  }

  /**
   * The viewer's Fit / Fill. Applied at once, at the same second (no reload), and kept as this profile's default so the
   * next film starts the same way. Before AVPlay has prepared only the choice is kept; afterPrepare applies it.
   */
  function setPicture(mode) {
    if (shut) return false;
    const wanted = normalisePicture(mode);
    pictureMode = wanted;
    if (settings && typeof settings.set === 'function' && typeof settings.choice === 'function') settings.set(settings.choice('pictureSize'), wanted);
    if (pictureReady) applyPicture();
    else emit('picture', pictureInfo());
    return true;
  }

  /** What AVPlay draws or stays quiet about, from the subtitle choice: the file's own track, or nothing (an add-on file is drawn by us). */
  function applySubtitleMode() {
    if (subMode === 'file' && textIndex !== null) {
      avplay.subtitlesOn(true);
      avplay.selectTrack('TEXT', textIndex);
    } else {
      avplay.subtitlesOn(false);
    }
  }

  // ---- what AVPlay tells us ----
  function handlersFor(mine) {
    const live_ = (fn) => (...args) => { if (mine === gen && !shut) fn(...args); };
    return {
      onBufferingStart: live_(() => {
        if (!playRequested) return;
        showLoading(loadingMessage());
        // A seek buffers too; only stalls in plain playback count.
        if (started && playing && clock.now() - seekedAt > SEEK_GRACE) stalled();
      }),
      onBufferingProgress: live_((percent) => {
        bufferPercent = percent;
        if (loading.visible && started) showLoading('Loading');
      }),
      onBufferingComplete: live_(() => {
        if (!playRequested) return;
        reloadAt = null;
        // Buffering done is not a picture: a decoder can refuse the video (unsupported profile, Dolby Vision P5, a broken
        // file) while AVPlay buffers happily. Only the overlay goes; START_WAIT keeps running until the time moves.
        hideLoading();
      }),
      onTime: live_((ms) => {
        lastTime = ms;
        // The picture signal: playback time advancing after play() (the decoder is rendering). Either 500 ms past where
        // we started, or two consecutive reports that increase.
        if (!started && playRequested) {
          const before = lastReport;
          lastReport = ms;
          if (ms >= startAt + PICTURE_MS || (before !== null && ms > before)) onFirstPicture();
        }
      }),
      onCompleted: live_(() => onEnded()),
      onError: live_((code) => onError(code)),
      onEvent: live_((id, data) => {
        if (id === 'PLAYER_MSG_HTTP_ERROR_CODE') {
          const m = /\d{3}/.exec(String(data));
          lastHttpStatus = m ? Number(m[0]) : 0;
          warn('HTTP status ' + lastHttpStatus + ' reported by AVPlay');
        }
      }),
      onSubtitle: live_(({ durationMs, text }) => {
        if (subMode !== 'file') return;
        const lines = cueLines(text);
        emit('subtitle', { lines: lines.length ? lines : null });
        cancel(fileSubTimer);
        fileSubTimer = after(() => emit('subtitle', { lines: null }), durationMs > 0 ? durationMs : 4000);
      }),
    };
  }

  /** The first picture of this source (Alder: onRenderedFirstFrame). */
  function onFirstPicture() {
    if (started) return;
    started = true;
    watched = true;
    retries = 0;
    hideLoading();
    cancel(startTimer);
    startTimer = null;
    // Next time: the same release for this video, and the same group (release and quality) for the next episode.
    if (memory) memory.remember(videoId, metaId, source());
    say('picture on, source ' + (at + 1) + '/' + sources.length + ' (' + source().label + ')');
    emit('started', { source: at });
  }

  /** The stream ran out. At the real end the next episode starts, unless the viewer chose to watch the credits. */
  function onEnded() {
    ended = true;
    lastTime = duration;
    // shortcut: sub-two-minute series streams are treated as add-on placeholders; revisit for short-form shows.
    if (isPlaceholder()) {
      started = false; // retry from the original resume point, not the placeholder's short ending
      ended = false;
      next('source ended as a short placeholder');
    } else if (nextVideo() !== null && !upNextDismissed) playNext();
    else exit();
  }

  function onError(code) {
    if (finished || shut) return;
    const text = code + (lastHttpStatus ? ' (HTTP ' + lastHttpStatus + ')' : '');
    warn('source ' + (at + 1) + '/' + sources.length + ' error: ' + text);
    if (diag) diag.error('source ' + (at + 1) + ': ' + text);

    // A seek that did not work is not a broken source.
    if (code === 'PLAYER_ERROR_SEEK_FAILED') { pendingSeek = null; return; }

    // A bad audio track (a decoder rejecting a packet) should not end the movie: drop that track and carry on from the
    // same second on the next best one.
    if (isDecodeError(code) && audioIndex !== null && !failedAudio.has(audioIndex)) {
      const outcome = afterAudioError(audioTracks, audioIndex, { language: audioLanguage(), failed: failedAudio });
      failedAudio = outcome.failed;
      if (outcome.ok && outcome.index !== null) {
        decide('audio: track #' + audioIndex + ' failed, ' + outcome.reason);
        audioIndex = outcome.index;
        reloadAt = started ? position() : startAt;
        say('Audio track changed after decoder error');
        emit('tracks');
        showLoading(loadingMessage());
        attempt(reloadAt, { forcedAudio: outcome.index });
        return;
      }
      decide('audio: track #' + audioIndex + ' failed and no other can play: ' + outcome.reason);
    }

    if (isRetryable(code, lastHttpStatus) && retries < RETRIES) {
      retries++;
      const here = started ? position() : startAt;
      reloadAt = started ? here : null;
      // AVPlay's own buffering already took a while: each retry of ours gets a fresh START_WAIT, or the start timeout would
      // move on to the next source before the second retry ran.
      cancel(startTimer);
      startTimer = after(onStartTimeout, RETRY_WAIT + START_WAIT);
      showLoading(loadingMessage());
      say('retry ' + retries + '/' + RETRIES + ' in ' + RETRY_WAIT + ' ms');
      after(() => { if (!shut && !finished) attempt(here, { forcedAudio: audioIndex !== null && audioPicked ? audioIndex : null }); }, RETRY_WAIT);
      return;
    }
    next(code);
  }

  /** This source failed: the next one from the same second or, with none left, the list to choose from. */
  function next(reason = "didn't start") {
    cancel(startTimer);
    startTimer = null;
    const here = position();
    if (at + 1 < sources.length) {
      at++;
      stalls = [];
      retries = 0;
      audioPicked = false;
      subsPicked = false;
      failedAudio = new Set();
      audioIndex = null;
      audioTracks = [];
      textTracks = [];
      shape = null;
      pictureApplied = null;
      subMode = 'off';
      textIndex = null;
      decide('source failed (' + reason + '); trying source ' + (at + 1) + '/' + sources.length + ' at ' + Math.round(here / 1000) + ' s');
      load(here, 'That source failed · trying the next one');
      return;
    }
    decide('source failed (' + reason + '); no sources left');
    if (params.picked) {
      avplay.stop();
      emit('sourceError');
      showLoading('That source failed · choose another source');
      return;
    }
    finish({ kind: 'sources', pick: true, message: sources.length + " sources didn't play", resumeAt: params.resumeAt });
  }

  // ---- progress ----

  // Progress every 10 s, pushed to Stremio every minute (Stremio's own apps push every 3 minutes).
  function tick() {
    tickTimer = null;
    record();
    if (++ticks % PUSH_EVERY === 0) push();
    tickTimer = after(tick, TICK);
  }

  function record() {
    // Nothing is saved until a picture shows: a source that never starts would otherwise reset the resume point.
    if (!started || live) return; // live TV has no progress to keep
    if (isPlaceholder()) return;
    if (!item) return;
    const here = position();
    if (!(duration > 0)) return;
    // Only real viewing counts as watched time: a seek moves the position by more than a tick allows.
    const moved = here - lastPosition;
    const played = moved >= 1 && moved <= TICK * 2 ? moved : 0;
    lastPosition = here;
    library.record(item, videoId, here, duration, played);
    const videos = meta ? meta.videos : null;
    if (!tickedWatched && videos && item.state && item.state.flaggedWatched === 1) {
      tickedWatched = true;
      library.markWatched(item, videos, videoId);
    }
    // Keep the current episode full screen; offer the next one only near its actual end.
    if (!upNextDismissed && !upNextVisible && duration - here < upNextWindow(duration)) showUpNext();
  }

  function push() {
    if (!watched || live) return;
    if (!authKey || !item || !stremio) return;
    const snapshot = JSON.parse(JSON.stringify(item));
    Promise.resolve(stremio.saveLibrary(authKey, [snapshot])).catch((e) => warn('saving progress failed: ' + (e && e.message ? e.message : e)));
  }

  /** What Alder's onStop does: pause, and keep the place. */
  function saveAndPause() {
    cancel(tickTimer); tickTimer = null;
    cancel(skipTimer); skipTimer = null;
    cancel(subsTimer); subsTimer = null;
    if (playing) { avplay.pause(); playing = false; emit('playing', { playing: false }); }
    if (!watched || live || isPlaceholder()) return;
    record();
    // The player's own episode list first: Home's Resume passes no next episode when the title's details weren't in yet,
    // and a finished episode with no next one drops the title out of Continue Watching.
    if (item) library.stopped(item, nextVideo() ? nextVideo().id : (params.nextVideoId || null));
    push();
  }

  /** The app was hidden (Home key, another source): AVPlay is suspended, the place is kept. */
  function suspend() {
    if (suspended || shut) return;
    suspended = true;
    saveAndPause();
    avplay.suspend();
    say('suspended');
  }

  function resume() {
    if (!suspended || shut) return;
    suspended = false;
    avplay.restore();
    if (pictureReady) applyPicture(); // the display settings are AVPlay's own: say them again after a suspend
    if (prepared) {
      lastPosition = position();
      tickTimer = after(tick, TICK);
      skipTimer = after(checkSegments, 0);
      if (subMode === 'addon') subsTimer = after(subtitleTask, 0);
    }
    say('restored');
  }

  function shutdown() {
    if (shut) return;
    if (!suspended) saveAndPause();
    shut = true;
    gen++;
    timers.forEach((id) => clock.clearTimeout(id));
    timers.clear();
    avplay.close();
  }

  /** Done: save, close AVPlay, and tell whoever shows us where to go. */
  function finish(nav) {
    if (finished) return;
    finished = true;
    shutdown();
    emit('navigate', nav);
  }

  function exit() { finish({ kind: 'exit' }); }

  // ---- the episode after this one, Up next ----
  function showUpNext() {
    if (isPlaceholder()) return;
    const following = nextVideo();
    if (!following) return;
    if (offeringLower) dismissStall();
    hideLoading();
    upNextVisible = true;
    emit('upNext', { video: following });
  }

  function dismissUpNext() {
    upNextDismissed = true;
    if (upNextVisible) { upNextVisible = false; emit('upNextHide'); }
  }

  /** Hands the next episode to the sources page, which starts it (preferring this release's group) and finishes here. */
  function playNext() {
    const following = nextVideo();
    if (!following) return exit();
    const videos = meta.videos;
    const after_ = videos[videos.indexOf(following) + 1];
    finish({ kind: 'next', video: following, afterVideoId: after_ && after_.season !== 0 ? after_.id : null });
  }

  // ---- stalls: three in a minute offer a lower quality, once ----
  function stalled() {
    const now = clock.now();
    stalls.push(now);
    while (stalls.length && stalls[0] < now - STALL_WINDOW) stalls.shift();
    const height = source().height;
    if (stalls.length !== STALLS_FOR_LOWER || offeringLower || upNextVisible || lowerSourceHeight(height) === null) return;
    offeringLower = true;
    emit('stall', { height, lower: lowerSourceHeight(height), position: position() });
  }

  function dismissStall() {
    if (!offeringLower) return;
    offeringLower = false;
    emit('stallHide');
  }

  /** Continue at the same second with one quality step lower. */
  function lowerQuality() {
    const lower = lowerSourceHeight(source().height);
    if (lower === null) return;
    finish({ kind: 'sources', pick: false, maxHeight: lower, resumeAt: position() });
  }

  /** The source list for this video, from this second; the player closes, and a pick starts a new one. */
  function changeStream() {
    finish({ kind: 'sources', pick: true, resumeAt: live ? undefined : position() });
  }

  // ---- skip intro, as NuvioTV does it ----
  // IntroDB (api.introdb.app, community timings by IMDb id, season and episode; no key, nothing personal sent) says where
  // an episode's intro, recap and credits are. Inside an intro or recap a "Skip intro" pill shows for 10 s, and OK jumps
  // to its end. The credits start, when known, is when Up next appears, rather than the last 4% guess.
  // ponytail: series with IMDb ids only; anime (AniSkip by MAL id) and films' credits aren't asked for.
  function fetchSegments() {
    const url = introDbUrl(type, metaId, videoId);
    if (!url || !http) return;
    Promise.resolve().then(() => http.get(url)).then((body) => {
      const parsed = parseSegments(JSON.parse(body));
      segments = parsed.segments;
      outroAt = parsed.outroAt;
      say('IntroDB: ' + segments.length + ' segment(s), credits ' + (outroAt ? Math.round(outroAt / 1000) + ' s' : 'unknown'));
    }).catch((e) => say('IntroDB gave nothing (' + (e && e.message ? e.message : e) + ')')); // degrades silently, never blocks
  }

  function setSkip(visible, label = '') {
    if (visible) {
      if (skipVisible && skipLabel === label) return;
      skipVisible = true;
      skipLabel = label;
      emit('skip', { visible: true, label });
    } else if (skipVisible) {
      skipVisible = false;
      skipLabel = '';
      emit('skip', { visible: false, label: '' });
    }
  }

  function checkSegments() {
    cancel(skipTimer);
    skipTimer = null;
    if (suspended || shut) return;
    if (!started || live) { skipTimer = after(checkSegments, CHECK_EVERY); return; }
    const here = position();
    const now = segments.find((s) => here >= s.start && here < s.end - 1000 && !skipped.has(s)) || null;
    if (!now || controlsShown) setSkip(false);
    else if (skipTag !== now || !skipVisible) {
      if (skipTag !== now) skipShownAt = clock.now();
      skipTag = now;
      setSkip(true, now.label);
    }
    if (now && skipTag === now && clock.now() - skipShownAt > SKIP_SHOWN) { skipped.add(now); setSkip(false); }
    if (outroAt > 0 && here >= outroAt && duration - here < 60000 && !upNextDismissed && !upNextVisible && duration > 0) showUpNext();
    skipTimer = after(checkSegments, CHECK_EVERY);
  }

  /** OK while the pill shows: jump to the end of the intro. */
  function skipSegment() {
    if (!skipVisible || !skipTag) return false;
    const target = skipTag.end;
    setSkip(false);
    seekTo(target);
    return true;
  }

  // ---- seeking ----

  /** Seeks now (a resume correction, the end of an intro, the end of a scrub). */
  function seekTo(ms) {
    if (shut) return;
    const target = Math.max(0, duration > 0 ? Math.min(ms, Math.max(0, duration - 1000)) : ms);
    seekedAt = clock.now();
    skipped.clear(); // back into an intro: offer it again
    skipTag = null;
    pendingSeek = target;
    emit('scrub', { position: target });
    avplay.seekTo(target).then(() => {
      if (pendingSeek === target) pendingSeek = null;
      seekedAt = clock.now();
    }, (e) => {
      if (!shut) warn('seek failed: ' + errorCode(e));
      if (pendingSeek === target) pendingSeek = null;
    });
  }

  /** Moves the playing point by [by] ms; the seek itself waits until the presses stop (SEEK_SETTLE). */
  function scrub(by) {
    if (shut || !(duration > 0) || live) return;
    const base = scrubTo >= 0 ? scrubTo : position();
    scrubTo = Math.min(Math.max(0, base + by), Math.max(0, duration - 1000));
    emit('scrub', { position: scrubTo });
    cancel(seekTimer);
    seekTimer = after(() => {
      seekTimer = null;
      if (scrubTo >= 0) { const target = scrubTo; scrubTo = -1; seekTo(target); }
    }, SEEK_SETTLE);
  }

  // ---- subtitles ----
  function subtitleTask() {
    subsTimer = null;
    if (subMode !== 'addon' || !shifted || suspended || shut) return;
    const hit = cueAt(shifted, position(), subHint);
    const cue = hit ? hit.cue : null;
    if (hit) subHint = hit.index;
    if (cue !== subShown) { subShown = cue; emit('subtitle', { lines: cue ? cue.lines : null }); }
    subsTimer = after(subtitleTask, SUBTITLE_EVERY);
  }

  async function loadAddonSubtitles() {
    if (!stremio || !authKey) return;
    try {
      const addons = (await stremio.addons(authKey)).filter((a) => a.serves('subtitles', type, videoId));
      const lists = await Promise.all(addons.map((a) => Promise.resolve().then(() => a.subtitles(type, videoId)).catch((e) => { warn('subtitles from ' + a.name + ' failed: ' + (e && e.message ? e.message : e)); return []; })));
      // ponytail: the TV's language and English, three files each in the add-on's order; a language picker if asked
      addonSubs = chooseAddonSubtitles([].concat(...lists), tvLanguage());
      say('add-on subtitles: ' + addonSubs.length);
      emit('tracks');
    } catch (e) {
      warn('add-on subtitles unavailable: ' + (e && e.message ? e.message : e));
    }
  }

  /**
   * The viewer's subtitle choice: { kind: 'off' } | { kind: 'file', index } | { kind: 'addon', sub }. An add-on file is
   * fetched, parsed and drawn by us from the same second: no reload, as the clock does the syncing.
   */
  async function selectSubtitle(choice) {
    if (shut) return false;
    const token = ++subChoiceToken;
    if (choice.kind === 'addon') {
      if (!http) return false;
      let cues;
      try { cues = parseSubtitles(await http.get(choice.sub.url), choice.sub.format); } catch (e) { cues = null; warn('subtitle file failed: ' + (e && e.message ? e.message : e)); }
      if (token !== subChoiceToken || shut) return false;
      if (!cues || !cues.length) { emit('notice', { message: "Couldn't load that subtitle" }); return false; }
      chosenSub = choice.sub;
      subCues = cues;
      subDelay = 0;
      shifted = cues;
      subHint = 0;
      subShown = null;
      subMode = 'addon';
      textIndex = null;
      applySubtitleMode();
      cancel(subsTimer);
      subtitleTask();
      decide('subtitles: add-on file from ' + choice.sub.addon + ' (' + choice.sub.language + ', ' + cues.length + ' cues)');
    } else {
      chosenSub = null; subCues = null; shifted = null; subDelay = 0; subShown = null;
      cancel(subsTimer); subsTimer = null;
      if (choice.kind === 'file') { subMode = 'file'; textIndex = choice.index; decide('subtitles: the file\'s track #' + choice.index); }
      else { subMode = 'off'; textIndex = null; decide('subtitles: off'); }
      applySubtitleMode();
      emit('subtitle', { lines: null });
    }
    emit('tracks');
    return true;
  }

  /** Alder's "Subtitle timing": the add-on file's times moved by [ms] (later when positive). */
  function setSubtitleDelay(ms) {
    if (subMode !== 'addon' || !subCues) return;
    subDelay = ms;
    shifted = shiftCues(subCues, ms);
    subHint = 0;
    subShown = null;
    cancel(subsTimer);
    subtitleTask();
    emit('tracks');
  }

  /** The viewer picked an audio track in the options panel. A track this TV cannot decode is refused. */
  function selectAudio(index) {
    if (shut) return false;
    const track = audioTracks.find((t) => t.index === index);
    if (!track) return false;
    if (track.playable === 'no') { emit('notice', { message: 'No sound on this TV' }); return false; }
    audioPicked = true; // once per video; picks made later in the settings menu stand
    audioIndex = index;
    avplay.selectTrack('AUDIO', index);
    decide('audio: picked #' + index + ' ' + track.codec);
    emit('tracks');
    return true;
  }

  // ---- play / pause ----
  function play() { if (!shut && avplay.play()) { playing = true; emit('playing', { playing: true }); } }
  function pause() { if (!shut && avplay.pause()) { playing = false; emit('playing', { playing: false }); } }
  function togglePlay() { if (playing) pause(); else play(); }

  // ---- starting ----

  async function loadMeta() {
    if (deps.loadMeta) return deps.loadMeta(type, metaId);
    if (!stremio || !authKey) return null;
    const addon = (await stremio.addons(authKey)).find((a) => a.serves('meta', type, metaId));
    if (!addon) return null;
    return addon.savedMeta(type, metaId) || addon.meta(type, metaId);
  }

  function begin(resume) {
    if (prepared || shut) return; // the library's answer can arrive after Back
    prepared = true;
    lastPosition = resume;
    load(resume);
    tickTimer = after(tick, TICK);
    skipTimer = after(checkSegments, 0);
  }

  function start() {
    if (!sources.length) { exit(); return; }
    fetchSegments();
    Promise.resolve().then(loadMeta).then((m) => { meta = m; emit('meta'); }).catch((e) => warn('episode list unavailable: ' + (e && e.message ? e.message : e)));
    loadAddonSubtitles();

    // "Start Over" plays from the beginning; a switch to a lower quality carries its own second.
    const known = params.startOver ? 0 : (typeof params.resumeAt === 'number' && params.resumeAt >= 0 ? params.resumeAt : null);
    // The stream starts at once from what is known here (the params, or the library saved on the TV) instead of waiting a
    // round trip to Stremio for the resume point; Stremio's answer corrects it if it moved elsewhere.
    if (known !== null) begin(known);
    else if (stremio && authKey) {
      Promise.resolve().then(() => stremio.savedLibrary(authKey)).then((list) => {
        const saved = list ? list.find((it) => it && it._id === metaId) : null;
        if (saved) begin(library.resumeAt(saved, videoId));
      }).catch(() => {});
    }
    if (!stremio || !authKey) { if (!prepared) begin(known === null ? 0 : known); return; }
    const settle = (result) => {
      item = result;
      const resume = known !== null ? known : item ? library.resumeAt(item, videoId) : 0;
      if (!prepared) begin(resume);
      // Watched further on the phone since the TV saved its copy: go there, unless you've already moved on.
      else if (known === null && Math.abs(resume - startAt) > RESUME_SLACK && position() < startAt + RESUME_SLACK) {
        startAt = resume;
        lastPosition = resume;
        if (playRequested) seekTo(resume); // else the load in progress picks up startAt
      }
    };
    Promise.resolve().then(() => stremio.library(authKey, [metaId])).then(
      // the answer for this title: asked by id, but whatever comes back is only used if it is this title's own item
      // (history written onto another title's item would be worse than none)
      (list) => settle((list && list.find((it) => it && it._id === metaId)) || library.newItem(metaId, type, params.name || '', params.poster)),
      (e) => { warn('library unavailable: ' + (e && e.message ? e.message : e)); settle(null); },
    );
  }

  // ---- what the views ask ----

  /** The title shown on the controls: Alder's pauseTitle and subtitle (S1 E4, or the year). */
  function titleInfo() {
    const label = params.episode || '';
    const episode = meta ? meta.videos.find((v) => v.id === videoId) : null;
    const fromParams = label.indexOf('  ·  ') >= 0 ? label.slice(label.indexOf('  ·  ') + 5).trim() : '';
    const title = meta
      ? (episode && episode.title && episode.title.trim() ? episode.title : meta.name)
      : fromParams || params.name || '';
    const sub = meta
      ? (episode ? 'S' + episode.season + ' E' + episode.episode : meta.year || '')
      : label.split('  ·  ')[0];
    // The top-left name: the title's name, else the meta's, never a bare id (an IMDb id is not a name)
    const named = [params.name, meta && meta.name].find((n) => n && n.trim() && !/^tt\d+$/i.test(n.trim())) || '';
    return { name: named, title, subtitle: sub, logo: (meta && meta.logo) || params.logo || null, hasNext: nextVideo() !== null, next: nextVideo() };
  }

  /** "1h 39m left", "Ends 1:06 AM" etc. for the paused screen. [wallMs]: the time now, for the end time. */
  function remainingFacts(wallMs) {
    if (live || !(duration > 0)) return { left: '', ends: '' };
    const here = scrubTo >= 0 ? scrubTo : position();
    const remaining = Math.max(0, duration - here);
    const d = new Date(wallMs + remaining);
    const h12 = d.getHours() % 12 || 12;
    return {
      left: runtime(Math.max(1, Math.floor(remaining / 60000)) + ' min') + ' left',
      ends: 'Ends ' + h12 + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + (d.getHours() < 12 ? 'AM' : 'PM'),
    };
  }

  Object.assign(api, {
    on(name, fn) {
      (listeners[name] = listeners[name] || []).push(fn);
      return () => { listeners[name] = (listeners[name] || []).filter((f) => f !== fn); };
    },
    start,
    exit,
    /** Closes without navigating (the screen was torn down by something else): saves and releases AVPlay. */
    destroy() { finished = true; shutdown(); Object.keys(listeners).forEach((k) => { listeners[k] = []; }); },
    suspend,
    resume,
    play, pause, togglePlay,
    scrub, seekTo,
    skipSegment,
    dismissUpNext, playNext,
    dismissStall, lowerQuality,
    changeStream,
    info() { finish({ kind: 'details' }); },
    selectAudio, selectSubtitle, setSubtitleDelay,
    setPicture, pictureInfo,
    /** The controls came up or went down: the Skip pill gives way to them. */
    setControlsShown(shown) {
      controlsShown = !!shown;
      if (controlsShown) setSkip(false);
    },
    titleInfo,
    remainingFacts,
    /** Everything the controls draw each half second. */
    snapshot() {
      return {
        position: scrubTo >= 0 ? scrubTo : position(), duration, playing, started, live, scrubbing: scrubTo >= 0,
        loading, source: at, sources: sources.length, upNext: upNextVisible, offeringLower,
      };
    },
    /** What the options panel lists. */
    tracks() {
      return { audio: audioTracks, audioIndex, text: textTracks, textIndex, subMode, addonSubs, chosenSub, subDelay, canShift: subMode === 'addon' && !!subCues };
    },
    /** The source playing, for the "Change stream" row of the options panel. */
    currentSource() { return source() || null; },
  });
  // getters must not go through Object.assign (it would copy their value once)
  Object.defineProperty(api, 'params', { get: () => params });
  Object.defineProperty(api, 'state', { get: () => ({ at, started, watched, retries, offeringLower, upNextVisible, prepared, finished, suspended, audioIndex, subMode, item }) });
  return api;
}
