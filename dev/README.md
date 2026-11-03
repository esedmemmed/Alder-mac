# dev/ — the harness that stands in for a TV

There is no TV, no Stremio and no internet in the workspace. This folder is how the app is run, driven and photographed
anyway. None of it ships: the production bundle (`dist/app`, `dist/Alder.wgt`) contains no trace of it (`npm run compat`
and `npm run build` check for `__fx`, `mock-tizen`, `ALDER_FIXTURE` and source maps).

| File | What it is |
|---|---|
| `mock-tizen.js` | `window.tizen` and `window.webapis` (AVPlay, productinfo, avinfo, key registration, application exit) |
| `mock-entry.js` | the dev build's entry for the mock: `index.html` loads it in place of `$WEBAPIS/webapis/webapis.js` |
| `fake-clock.js` | `createFakeClock()` for tests: timers fire only when the test advances time |
| `fixture-server.mjs` | serves the dev build and answers every "remote" request from `dev/fixtures/` |
| `screenshot.mjs` | headless Chromium at 1920x1080: presses remote keys, checks the screen, saves PNGs to `shots/` |
| `scenarios/*.mjs` | what `screenshot.mjs` runs, one file per phase (`phase5.mjs`: the whole journey from a fresh install to Diagnostics, and the 4x performance numbers) |
| `fixtures/` | Phase 2's fake Stremio account and add-ons (see `fixtures/README.md`) |

## Scripts

```
npm run build:dev            dist/dev: the app + the mock, unminified, with source maps
npm run dev                  build:dev, then serve dist/dev at http://127.0.0.1:8080 with the fixtures
npm run dev -- --port 9000 --no-build --lan      other port / skip the build / listen on the LAN (e.g. for a phone)
npm run shots                every scenario in dev/scenarios, PNGs into shots/<scenario dir>/
npm run shots -- --only phase1 --throttle 4      one scenario, 4x CPU slowdown (a rough TU8000 stand-in)
npm test                     node --test "test/**/*.test.js"
```

Open the dev server in any Chromium. `?clock=12:03%20AM` freezes the top-bar clock for screenshots. The keyboard is the remote: arrows, Enter = OK, Escape or Backspace = Back,
Space = play/pause, `[` and `]` = rewind / fast-forward, digits, and the same codes the TV sends (10009 for Back).
A `?mock.device=fhd` query on the page URL makes the mock pretend to be a 1080p set without HDR (default `tu8000`).
`window.__alder` (dev only) exposes the app context; `window.__mockTizen.registry` is the AVPlay scenario registry.

## Fixture server

Every absolute `http(s)` URL the app requests is rewritten, in dev builds only, to
`<origin>/__fx/<host>/<path>?<query>` (a `:` in the host becomes `_`: `192.168.1.5:7000` is `192.168.1.5_7000`).
The server looks under `dev/fixtures/<host>/` for the first existing file of:

1. `<path>.<METHOD>.<key>.json` (POST/PUT only; `key` is the body's `collection`, else its `type`)
2. `<path>.<key>.json`
3. `<path>.<METHOD>.json`
4. `<path>` exactly (add-on URLs already end in `.json`)
5. `<path>.json`
6. `<path>/index.json`

The query string is ignored when matching, the path is percent-decoded. Pictures (`.jpg`, `.png`, `.webp`, `/poster/`,
`/background/`, `/logo/`, image hosts) with no file get a generated SVG placeholder, so every screen can be drawn.
Anything else answers 404 with a JSON body and is logged.

Test knobs, taken off the request URL before matching:

- `?__delay=800` answers after 800 ms (slow add-on, spinner states)
- `?__status=503` answers with that status and the fixture body (error and retry states)

Other endpoints: `/__fx/_health`, `/__fx/_requests` (the log of what was asked, as JSON), and
`/__fx/_media/test.webm`, a 30 s test video made with `ffmpeg` on first use (only for the `media=video` mock mode below).

## The AVPlay mock

`createAvplayMock({ clock, registry, video, log, strict })` follows the shape of Samsung's `webapis.avplay`:

- states `NONE → IDLE → READY → PLAYING ⇄ PAUSED`; a call in the wrong state throws a `MockWebApiError` named
  `InvalidStateError` (turn off with `strict: false`)
- `open(url)`, `setListener({...})`, `prepareAsync(ok, err)`, `play`, `pause`, `stop`, `close`, `seekTo`, `jumpForward`,
  `jumpBackward`, `getDuration`, `getCurrentTime`, `getTotalTrackInfo`, `getCurrentStreamInfo`, `setSelectTrack(type, index)`,
  `setStreamingProperty`, `setDisplayRect`, `setDisplayMethod`, `setSilentSubtitle`, `setExternalSubtitlePath`, `suspend`, `restore`, ...
- listener callbacks `onbufferingstart`, `onbufferingprogress`, `onbufferingcomplete`, `oncurrentplaytime`, `onstreamcompleted`,
  `onerror`, `onerrormsg`, `onevent`, always delivered asynchronously, never inside the call that caused them
- `getTotalTrackInfo()` returns `[{ index, type: 'VIDEO'|'AUDIO'|'TEXT', extra_info: '<JSON string>' }]`

By default the clock is the real one. Tests pass `createFakeClock()` and `await clock.advance(ms)`.

Like the real player, the mock goes quiet at `close()` and `stop()`: every pending timer (prepare answer, seek answer, the picture
starting, a stall ending, queued events) is cancelled and nothing is delivered afterwards, so a late answer of an old session can
never reach a new one. `avplay.__mock.pendingTimers` is 0 after a close; `test/player/engine.close.test.js` leans on it.

### Choosing what a URL does

Every URL passed to `open()` gets a scenario. Layers, lowest first: defaults, a guess from the release name
(`DTS` in the name gives DTS audio, `DDP5.1` gives E-AC-3, both give a DTS + AC3 file), registry entries, and `mock.*`
query parameters on the URL itself. Options accept the same values in both places.

| Option | Values | Effect |
|---|---|---|
| `tracks` | `eac3 ac3 aac dts dtshd truehd mixed mixed2 multi dub none subs`, joined with `+` (`dts+subs`), or a JSON array of `{type, codec, lang, channels, default}` | the audio / text tracks (a video track is added). `mixed` = DTS selected by default plus an AC3 track: the player must switch |
| `duration` | seconds | length of the stream (default 5400) |
| `prepare` | `ok`, `never`, `fail`, `fail:PLAYER_ERROR_INVALID_URI`, `slow:3000` | what `prepareAsync` does: never answers / calls the error callback / answers after N ms |
| `start` | `ok`, `never`, `error`, `error:CODE`, `slow:9000` | after `play()`: buffering never completes (no picture) / `onerror` / buffering takes N ms |
| `error` | `30`, `30:PLAYER_ERROR_CONNECTION_FAILED` | an `onerror` this many seconds into playback |
| `stall` | `10:3`, `40:forever`, repeatable | buffering starts at second 10 and lasts 3 s (the clock freezes); `forever` never ends |
| `seek` | `ok`, `fail` | `fail` calls the error callback and emits `PLAYER_ERROR_SEEK_FAILED` |
| `badAudio` | `silent` (default), `error` | selecting an audio codec the TV cannot decode: plays silently (what a TU8000 does with DTS) or raises `PLAYER_ERROR_NOT_SUPPORTED_FORMAT` |
| `style` | `matroska` (default), `mime`, `fourcc` | how codecs are written in `extra_info.fourCC` (see "Uncertain" below) |
| `indexing` | `per-type` (default), `global` | track `index` restarts per type, or counts across all tracks |
| `video`, `res` | `hevc`, `3840x2160` | the video track |
| `media` | `sim` (default), `video` | `video`: a hidden `<video>` supplies real time and pictures; the URL must be playable by Chromium, e.g. `/__fx/_media/test.webm` |
| `startMs`, `prepareMs`, `seekMs` | ms | the delays |

```
http://x/Movie.mkv?mock.tracks=mixed&mock.stall=20:5&mock.error=300
```

From a test or the browser console:

```js
const reg = createRegistry()
  .add('Dune.2021', { tracks: 'dts', start: 'never' })          // substring of the URL
  .add(/2160p/, { video: 'hevc', res: '3840x2160' })            // RegExp
  .add((u) => u.endsWith('.avi'), { prepare: 'fail' });         // function
const av = createAvplayMock({ clock, registry: reg });
// in the page: window.__mockTizen.registry.add('Dune', { tracks: 'multi' })
```

Earlier registry entries win over later ones for the same key.

### Inspecting and forcing things: `avplay.__mock`

`calls` (every API call with the time), `scenario`, `url`, `position`, `started` (the picture has begun), `frozen`,
`selected` (selected track index per type), `audioOutput` (`'none'`, `'silent'`, or the codec being heard),
`display`, `subtitle`, `props`, `emit(name, ...args)` (call a listener callback), `fail(code)` (force `onerror`),
`stall(forSec)` (force a stall), `reset()` (clear the call log). Not part of Samsung's API: never call it from `src/`.

### Uncertain: where the mock may differ from a real TV

Nobody has run this against hardware yet. Everything below is the first thing to check on a TU8000, and the code that
reads it (Phase 3 `src/player`) must tolerate all the variants the mock can produce:

- the field names in `extra_info` (`language` vs `track_lang`, `channels`, `fourCC`, `Bit_rate`, `sample_rate`) and how
  codecs are spelled; `style` and `indexing` exist so tests cover the variants
- whether `index` restarts per type or counts across all tracks
- timing: when `onbufferingcomplete` arrives after `play()`, the cadence of `oncurrentplaytime` (the mock: every 500 ms)
- that an unplayable audio codec is silent instead of an error (`badAudio` covers both)
- exactly which error names `prepareAsync`'s error callback receives
- seeking before `onbufferingcomplete`, `suspend`/`restore` after the app was hidden

## Screenshot scenarios

`dev/scenarios/<name>.mjs` default-exports an array of
`{ name, dir, url, run({ page, server, press, hold, shot, expect, focused }) }`.
`press('right', 5)` sends five remote presses (keys: `left right up down ok back playpause rw ff`), `hold('ok', 800)`
holds OK, `shot('02-name')` saves `shots/<dir>/02-name.png`, `expect(cond, message)` records a check, `focused()` reports
`{ text, index, group }` of the focused element. A scenario fails on any failed `expect`, any uncaught page error, any
`console.error`, and any failed request. `npm run shots` exits 1 when anything failed. `shots/` is git-ignored.
