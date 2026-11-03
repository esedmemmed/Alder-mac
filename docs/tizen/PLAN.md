# Alder for Tizen — Project Plan

Alder (Android TV Stremio client, `esedmemmed/Alder`, GPL-3.0) rebuilt as a Samsung Tizen web app for a
**2020 Samsung TU8000 (Tizen 5.5, 4K, HDR10/HDR10+, no Dolby Vision, no DTS, no TrueHD)**.
Installed from an **Android phone (Galaxy S25 Ultra) with the Apps2Samsung app**. No PC required.

Rule zero: **reference Alder, don't reinvent.** Every behaviour, constant, threshold and screen comes from the
Android source at `/home/claude/esedmemmed/alder/app/src/main/java/dev/alder/` unless this plan says it changes
for Tizen. When in doubt, read the Kotlin and port it.

---

## 1. Goal and scope

**In scope (parity with Alder 1.1)**
- Stremio TV sign-in (link code + QR), up to 5 profiles with optional PIN and colours, stream add-on sharing between profiles.
- Home with pages Home / Shows / Movies / Live / My List, catalog rows from the account's add-ons, Continue Watching, genre chips, paging.
- Title page (details, episodes by season, watched ticks, My List toggle, Play/Resume, Start Over).
- Sources page (hold OK on Play, or after 3 failures): ranked list with BEST MATCH, quality/release/size columns, tags.
- One-press Play: rank → try up to 3 sources, 12 s no-picture failover, 2 network retries 1.5 s apart, lower-quality offer on repeated stalls.
- Player: own controls, scrub with settle, audio/subtitle panel, add-on subtitles (OpenSubtitles) with timing shift, Up Next, Skip Intro (IntroDB), progress sync to Stremio (tick 10 s, push 60 s), resume logic, watched bitfield.
- Search (add-on search catalogs, recent searches per profile), Settings (stream preferences + presets, audio language, subtitles), Add-ons manager (reorder/remove/install by URL).

**Changes for Tizen (deliberate)**
| Alder (Android) | Alder Tizen |
|---|---|
| ExoPlayer + ffmpeg software audio (plays DTS/TrueHD) | Samsung **AVPlay** (hardware only). DTS/TrueHD/DTS-HD/DTS:X cannot play. **Audio rule** (section 5) avoids them. |
| `MediaCodecList` device detection | `webapis.productinfo` / `webapis.avinfo` + a static TU8000/2020 profile as fallback |
| Self-update from GitHub (`Updates.kt`) | **Dropped.** Updates are reinstalled with Apps2Samsung. A small "version x.y" line in Settings. |
| Android TV Watch Next channel (`WatchNext.kt`) | **Dropped** (no Tizen equivalent for sideloaded apps). |
| Frame-rate matching | **Dropped** (AVPlay has no per-app display-mode switching on Tizen 5.5). |
| Receiver passthrough setting | **Dropped** (TU8000 cannot pass DTS/TrueHD). |
| SharedPreferences | `localStorage` (namespaced keys, same names as Alder) |
| `Http.keep`/`savedAnswer` disk cache | `localStorage` cache for addon list, library, catalogs, metas (size-capped LRU) |

**Added for Tizen**
- **Diagnostics screen** (Settings → About → hold OK on version): last 200 log lines, current stream's AVPlay track info
  (codec per audio track), device profile, last errors. The owner only has a phone and a remote: this replaces logcat.
- **Transcode hook** (interface only, no implementation yet): `src/player/sources.js` exposes `resolvePlayableUrl(stream)`;
  default returns `stream.url`. A future TorBox-transcoder or home-server provider plugs in here to unlock DTS/TrueHD files.

**Out of scope:** torrent streams without `url` (need a streaming server; Alder skips them too), Live TV tuner, Samsung store publishing.

---

## 2. Target platform constraints (hard rules for every agent)

- **Web engine: Tizen 5.5 = Chromium M69 (verify on Samsung's "Web Engine Specifications" page; if older, lower targets).**
  - JS is bundled by **esbuild** with `--target=chrome69`, so modern *syntax* is fine in source.
  - esbuild does **not** polyfill APIs. Forbidden unless polyfilled in `src/lib/compat.js`:
    `Promise.allSettled`, `Promise.any`, `Object.fromEntries`, `String.prototype.replaceAll`, `Array.prototype.at`,
    `structuredClone`, `CompressionStream`, `queueMicrotask`, `ResizeObserver`, `IntersectionObserver` (M58 ok, but use sparingly),
    `globalThis` (M71), `Array.prototype.flat/flatMap` are M69 (ok).
  - CSS forbidden: flex/grid `gap` (M84), `aspect-ratio`, `inset`, `:focus-visible`, `:is()/:where()`, CSS nesting,
    `backdrop-filter`, `clamp()/min()/max()` (M79), container queries, `color-mix`, `lch/oklch`. CSS variables are fine.
  - `scripts/compat-check.mjs` greps `src/` and `dist/` for these and fails the build.
- **Performance budget (2020 entry CPU, ~1.5 GB RAM):** first Home paint < 2.5 s from cached data; D-pad focus move < 50 ms;
  max ~150 card DOM nodes alive per page (virtualise rows horizontally, mount ±1 screen); animate only `transform` and `opacity`;
  no box-shadow animation, no blur, no video backgrounds; poster images at metahub "small/medium" sizes, max 6 concurrent image loads, newest focus first (Alder `Images.newestFirst`).
- **Resolution:** app renders at a fixed **1920×1080** CSS viewport (`<meta name="viewport" content="width=1920">`); Alder's dp values ×1.5 ≈ px at 1080p (Alder designs at 1280×720 dp... verify against `Screen.kt` and adjust).
- **Input:** D-pad, OK (Enter 13), Back (10009), Play/Pause/Stop/FF/RW/Prev/Next media keys, colour keys, number keys (PIN). Register keys via `tizen.tvinputdevice.registerKeyBatch`. Long-press OK = keydown repeat / >600 ms hold (Alder "hold OK").
  Dev harness maps keyboard: arrows, Enter, Backspace/Escape=Back, Space=Play/Pause, `[`/`]`=RW/FF.
- **Network:** `config.xml` declares `<access origin="*" subdomains="true"/>` and the internet privilege. Stremio API and add-ons send CORS headers; IntroDB may not — wrap failures silently (feature degrades, never blocks).
- **No frameworks.** Vanilla ES modules + small DOM helpers. Allowed runtime deps (MIT/BSD only, vendored via npm, bundled): `pako` (zlib for watched bitfield), `qrcode-generator` (QR). Anything else needs Opus approval in `docs/DECISIONS.md`.
- **Privileges** (keep minimal, never Partner-level, or Apps2Samsung signing fails): `internet`, `tv.inputdevice`, `productinfo`, `avplay` is privilege-free. Check `Apps2Samsung.Core/Packaging/WgtPrivileges.cs` in `/home/claude/refs/Apps2Samsung` before adding any.
- **Licence:** GPL-3.0 (derivative of Alder). Keep Alder credit in README and About.

---

## 3. Architecture

```
alder-tizen/
  config.xml            Tizen widget config (id, privileges, access, icon, content src)
  index.html            single page, 1920x1080
  icon.png              512x512 from Alder's logo (res/drawable-nodpi/logo.webp)
  src/
    main.js             boot: compat polyfills, key registration, router start
    lib/                compat.js, dom.js (h(), classes), store.js (localStorage JSON, namespaced), log.js (ring buffer),
                        http.js (fetch with timeout, retries, cache keep/saved), keys.js (key codes, hold detection),
                        focus.js (spatial navigation engine), images.js (prioritised loader), i18n-lang.js (ISO 639-1/2 names)
    core/               PURE logic, no DOM, unit-tested in Node:
                        stremio.js, addon.js (Addon, Meta, Video, Stream, Subtitle), library.js, profiles.js,
                        settings.js, device.js, ranking.js (rank, wanted, preference, readyStreams, presets), audio.js (section 5)
    player/             avplay.js (thin promise wrapper over webapis.avplay), engine.js (sources, failover, retries, tick/push),
                        sources.js (resolvePlayableUrl hook), subtitles.js (fetch/shift/render SRT+VTT), introdb.js, controls.js, options.js
    screens/            profiles.js, signin.js, home.js, details.js, streams.js, search.js, settings.js, addons.js, diagnostics.js
    ui/                 components: card.js, row.js (virtualised), button.js, chip.js, panel.js, toast.js, keyboard-input.js; styles/*.css (tokens.css = Alder colours/sizes)
  dev/                  mock-tizen.js (tizen + webapis + AVPlay mock driven by <video> with fake track info), fixture-server.mjs,
                        fixtures/ (Stremio API + add-on JSON captured from Alder's shapes), screenshot.mjs (Playwright)
  scripts/              build.mjs (esbuild → dist/, copy assets, zip → dist/Alder.wgt), compat-check.mjs
  test/                 node:test unit tests for src/core and src/player/engine (with fake AVPlay)
  docs/                 SETUP.md (phone install guide), DECISIONS.md, REVIEW-*.md (Opus reviews), TV-TEST.md (on-TV checklist)
```

- **Router:** stack of screens; Back pops; each screen has `mount(root, params)`, `unmount()`, `onKey(e) → handled`.
- **Focus engine:** spatial nav over elements with `data-focus`, groups with `data-focus-group` (rows remember last index, like Alder's rows), explicit overrides `data-up/down/left/right`. Focus style = Alder's tungsten rim (scale 1.06 + outline), transform-only.
- **Dev/prod switch:** `window.ALDER_ENV` set by build (`prod` | `dev`). In dev, `http.js` rewrites `api.strem.io`, `link.stremio.com`, add-on hosts and `api.introdb.app` to the fixture server; prod never contains fixture code (tree-shaken).
- **Strings:** English only for v1, kept in `src/ui/strings.js` (Alder's wording).

---

## 4. Alder → Tizen file map (port sources)

| Alder (Kotlin) | Tizen (JS) | Notes |
|---|---|---|
| `Stremio.kt` | `core/stremio.js` | Same endpoints/bodies: link create/read, addonCollectionGet/Set, datastoreGet/Put, logout; `saving` overlay map; cache keep/saved |
| `Addon.kt` (Addon, Meta, Video, Stream, Subtitle, runtime()) | `core/addon.js` | Port regexes **verbatim**; `Locale.displayLanguage` → `lib/i18n-lang.js` table |
| `Library.kt` | `core/library.js` | Watched bitfield with `pako` (inflate/deflate level 6, base64) — must round-trip with stremio-core |
| `Profiles.kt` | `core/profiles.js` | MAX 5, same colours, shareStreams, streamLenders |
| `SettingsActivity.kt` (`object Settings` + presets) | `core/settings.js` + `screens/settings.js` | Drop matchFrameRate, passthrough |
| `StreamsActivity.kt` (readyStreams, rank, preference, wanted, sourceSize, sourceSummary) | `core/ranking.js` + `screens/streams.js` | Add audio rule (section 5) |
| `Device.kt` | `core/device.js` | See section 5 |
| `PlayerActivity.kt` | `player/*` | Constants: TICK 10 s, RESUME_SLACK 10 s, SKIP 10 s, SEEK_SETTLE 600 ms, SKIP_SHOWN 10 s, HIDE 5 s, START_WAIT 12 s, RETRIES 2, RETRY_WAIT 1.5 s, TRY 3; upNextWindow, plausibleEpisode, lowerSourceHeight |
| `MainActivity.kt` | `screens/home.js` + `ui/row.js` | Pages, cinema/hero, rows, chips, My List |
| `DetailsActivity.kt` | `screens/details.js` | |
| `SearchActivity.kt` | `screens/search.js` | Tizen IME via `<input>`; also an on-screen letter grid like Alder |
| `ProfilesActivity.kt`, `Qr.kt` | `screens/profiles.js`, `screens/signin.js` | QR via qrcode-generator |
| `AddonsActivity.kt` | `screens/addons.js` | |
| `Images.kt` | `lib/images.js` | |
| `Http.kt` | `lib/http.js` | |
| `Screen.kt` | `ui/*`, `styles/tokens.css` | Colours, type sizes, spacing tokens |
| Visual reference | `/home/claude/esedmemmed/alder/docs/*.png|jpg` | Match these screenshots |

---

## 5. Audio and device rules (the Tizen-specific heart)

**Device profile** (`core/device.js`): `{ hevc, av1, dolbyVision, hdr, height, audio: Set }`
- `height`: 2160 if `webapis.productinfo.isUdPanelSupported()` else 1080. `hdr`: `webapis.avinfo.isHdrTvSupport()`.
- `hevc: true`, `dolbyVision: false`, `av1: false` (2020 support unverified; Settings → Advanced toggle "My TV plays AV1", default off).
- `audio`: playable = `AAC, AC3 (DD), EAC3 (DD+, incl. DD+ Atmos/JOC), MP3, FLAC, OPUS, VORBIS, PCM/LPCM`;
  unplayable = `DTS, DTS-HD MA, DTS:X, TRUEHD (incl. Atmos on TrueHD)`.
- If `webapis` is missing (dev) or throws, fall back to the TU8000 profile above and log it.

**Stage A — before playing (names):** `core/audio.js` classifies each stream's audio from `filename + title + description`:
- `good` if it names DD+/DDP/EAC3/E-AC-3/DD/AC3/AAC/Opus/FLAC/MP3 **and** no unplayable codec;
- `bad` if it names only unplayable codecs (DTS*, TrueHD) and no playable one;
- `mixed` if both (multi-audio releases often carry AC3 next to DTS) — playable after track check;
- `unknown` otherwise.
- Ranking: `bad` streams are **excluded from auto-play** and shown last in the Sources list with a "No sound on this TV" tag
  (still selectable). Within Alder's existing rank keys, prefer `good` > `mixed` > `unknown`. This is an added key placed after
  Alder's `fit()` and before Settings' `preference()`; document it in DECISIONS.md.

**Stage B — after AVPlay prepare (real tracks):** read `getTotalTrackInfo()`; for AUDIO tracks parse `extra_info` (JSON: `fourCC`, `language`, `channels`).
- Pick the best playable track: Alder's `bestAudio` order (Settings audio language → TV language → original, not dub/commentary), skipping unplayable fourCCs.
- If the *selected-by-default* track is unplayable and a playable one exists → `setSelectTrack('AUDIO', idx)` before play.
- If **no** playable track → treat as a source failure ("no playable audio") → next source from the same second (Alder's `next()`).
- Mid-film audio error → same as Alder: drop that track, continue on next best at the same second.
- Log every decision to the diagnostics ring buffer (codec list, chosen track, reason).

**Headers:** AVPlay cannot send arbitrary request headers. Streams with `behaviorHints.proxyHeaders.request` → try `setStreamingProperty('USER_AGENT', …)` / cookie where applicable; if other headers are required, rank such streams last and mark "may not play". Log it.

---

## 6. Phases, agents, deliverables

Agents: **Sonnet** for implementation, **Haiku** for mechanical work (fixtures, docs proofreading). **Opus (manager)** writes no code: plans, reviews, decides.
Every agent: reads `AGENTS.md` + this plan, works only in its listed paths, commits its own work with clear messages, ends with a report
(what was built, what deviates from Alder and why, open questions, test results).

### Phase 1 — Foundation (Sonnet) ║ parallel with Phase 2
Paths: `config.xml, index.html, icon.png, package.json, scripts/, dev/ (except fixtures content), src/main.js, src/lib/ (except none), src/ui/ (components + tokens), test/lib/`
1. `package.json` (esbuild, pako, qrcode-generator, playwright already at `/opt/pw-browsers` — use `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`), npm scripts: `build`, `build:dev`, `dev` (fixture server + static), `test`, `compat`, `shots`.
2. `config.xml` per section 2; app id `AldrTizen0.Alder` style (10-char package id + name); version 0.1.0.
3. `scripts/build.mjs`: esbuild bundle (chrome69, minify in prod), copy html/css/icons, produce **unsigned `dist/Alder.wgt`** (zip with `config.xml` at root). Apps2Samsung re-signs on install.
4. `scripts/compat-check.mjs` per section 2.
5. `src/lib/*` per section 3, with unit tests for http (timeouts/retries), store, keys (hold detection), focus (spatial nav on a fake grid via jsdom-free geometry functions).
6. `dev/mock-tizen.js`: `tizen.tvinputdevice`, `webapis.productinfo/avinfo`, and an **AVPlay mock** over a hidden `<video>` (supports open/prepareAsync/play/pause/seekTo/jumpForward/getCurrentTime/getDuration/getState/getTotalTrackInfo with configurable fake tracks incl. DTS-only, mixed, AC3; listener callbacks onbufferingstart/complete, oncurrentplaytime, onerror, onstreamcompleted; failure injection: never-start, error-after-N-sec, stall).
7. `dev/fixture-server.mjs` serving `dev/fixtures/**` with CORS; `dev/screenshot.mjs` drives Chromium at 1920×1080, sends key sequences, saves PNGs to `shots/`.
8. `src/ui/styles/tokens.css` from `Screen.kt` (colours, type scale, radii, spacing) and base components (card, row with virtualisation, button, chip, panel, toast).
9. A demo screen proving: focus moves across 3 rows × 40 cards, Back works, build → `dist/Alder.wgt` exists, compat passes, screenshot captured.

### Phase 2 — Core logic port (Sonnet) ║ parallel with Phase 1
Paths: `src/core/`, `test/core/`, `dev/fixtures/`
1. Port `Stremio.kt, Addon.kt, Library.kt, Profiles.kt, Settings (object), Device.kt, StreamsActivity ranking` per section 4 — pure functions/classes, `fetch` injected (`deps.http`), storage injected (`deps.store`) so Node tests run without DOM.
2. `core/audio.js` + ranking integration per section 5.
3. Tests (node:test): every regex in `Stream` (height, DV, HDR, HEVC, AV1, remux/bluray/web/cam, 3D, hard subs, multi/dub, bigAudio), `fit`, `playableOn`, `rank` stability, `wanted`, presets ("Add-on's order", "Best picture", "Balanced", "Fast start"), `readyStreams` gaps/800 ms rule, `runtime()`, Library `continueWatching/resumeAt/record/stopped/markTitleWatched`, **watched bitfield round-trip against a known stremio-core string** (craft vectors; if none available, encode→decode symmetry + anchor shift cases), audio classifier on 40+ realistic release names.
4. Fixtures: realistic JSON for addonCollectionGet (Cinemeta + Torrentio-like + OpenSubtitles + a search catalog), datastoreGet library (movie in progress, series mid-season), catalogs, metas (movie + series with 2 seasons), streams (20 mixed: 4K DV P5, 4K HDR DTS-HD only, 1080p DDP, multi DTS+AC3, cam, 3D, mock action placeholder), subtitles, IntroDB answer, link create/read.

### Phase 3 — Player (Sonnet) — after 1+2 reviewed
Paths: `src/player/`, `test/player/`, `src/screens/diagnostics.js`
- Port `PlayerActivity.kt` behaviour into `engine.js` (state machine, testable with fake AVPlay + fake clock) and `controls.js/options.js` (UI matching `docs/controls.jpg`, `docs/tracks.jpg`).
- Section 5 Stage B audio logic, failover, retries, stall → lower quality, resume/RESUME_SLACK, progress tick/push via `core/library.js` + `core/stremio.js`, Up Next, Skip Intro, add-on subtitles (fetch SRT/VTT, shift, render in an overlay div; file's own subs via AVPlay text tracks).
- AVPlay specifics: `avplay.open → setListener → setDisplayRect(0,0,1920,1080) → prepareAsync → setSelectTrack → play`; `suspend/restore` on app hide/show (visibilitychange); `close()` on exit. Read Samsung AVPlay API docs; record doubts in DECISIONS.md.
- Tests: failover order, 12 s no-picture, retries, DTS-only → next source, mixed → AC3 track chosen, progress math.

### Phase 4 — Screens (two Sonnet agents in parallel) — after Phase 3 reviewed
- **4A** Paths: `src/screens/{profiles,signin,home}.js`, `src/ui/` additions for them. Profiles picker + PIN pad, TV sign-in (link code + QR + email/password fallback), Home pages/rows/hero/chips, My List.
- **4B** Paths: `src/screens/{details,streams,search,settings,addons}.js`. Title page, Sources list, Search (IME + letter grid, recents), Settings (presets, audio language, subtitles, AV1 toggle, version, diagnostics entry), Add-ons manager.
- Both: match Alder screenshots in `/home/claude/esedmemmed/alder/docs/`; screenshot every screen via `npm run shots` into `shots/4a|4b/`.

### Phase 5 — Integration, performance, release (Sonnet + Haiku for docs)
- Wire everything, full journey test in Chromium with fixtures (sign in → pick profile → home → title → play (mock) → failover → back → progress shows in Continue Watching).
- Performance pass with Chromium CPU throttling ×4 as a TU8000 proxy: measure focus latency and first paint; fix to budget.
- Prod build `dist/Alder.wgt`, size report, compat check clean.
- `docs/SETUP.md` (phone install, section 7) and `docs/TV-TEST.md` (on-TV checklist, section 8). Haiku proofreads.

### Review gate (Opus, after every phase)
1. `npm test`, `npm run compat`, `npm run build` all green — run myself, not trusted from the report.
2. Read the full diff of the phase; check against this plan and against the Alder source for the ported parts (constants, regexes, thresholds).
3. Look at every screenshot vs Alder's.
4. Write `docs/REVIEW-phaseN.md`: pass / fixes required. Fixes go back to the same agent (SendMessage) or a new one.

---

## 7. Setup on the owner's side (phone only)

One time, ~20 minutes:
1. **Phone:** install **Apps2Samsung** Android app (F-Droid repo `https://apps2samsung.com/fdroid/repo`, or the `-android.apk` from its GitHub releases, or Obtainium).
2. **TV:** Apps panel → press **1 2 3 4 5** on the remote → Developer Mode **On** → Host PC IP = **the phone's Wi-Fi IP** (phone: Settings → Connections → Wi-Fi → ⚙ on the network → IP address) → OK → restart the TV (hold power until it restarts).
3. **Phone:** open Apps2Samsung (same Wi-Fi as TV) → it finds the TV → sign in with a Samsung account once when asked (creates the certificate for this TV).

Every install/update:
4. Download `Alder.wgt` to the phone (from the chat, or later from GitHub Releases).
5. Apps2Samsung → **Custom WGT / TPK** → pick `Alder.wgt` → Install. Alder appears in the TV's Apps.

If the TV is found but install fails: check Host PC IP still equals the phone's IP (DHCP may change it; set a reserved IP in the router), and that Developer Mode is still On.

---

## 8. On-TV acceptance (owner runs, reports with phone photos of Diagnostics)

1. Launches in < 5 s, sign-in by QR works, profile created.
2. Home rows load; D-pad feels instant; Back exits cleanly.
3. A WEB-DL 1080p DD+ film: Play → picture + sound < 8 s.
4. A 4K HDR10 film: HDR badge on TV, sound OK.
5. A title whose top sources are DTS-only: Alder skips them automatically and plays a DD+/AC3 one.
6. A multi-audio (DTS + AC3) file: plays with AC3 track selected (Diagnostics shows the decision).
7. Kill a stream mid-way (pull network 5 s): resumes; long outage → next source at same second.
8. Progress appears in Stremio on the phone within ~1 minute; resume point matches.
9. Series: Up Next at credits, next episode starts; watched ticks show in Stremio phone app.
10. Subtitles: add-on SRT shows, timing shift works.
Failures → owner sends photo of Diagnostics → Opus triages → fix agent → new `Alder.wgt`.

---

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Chromium version on TU8000 older than M69 | Agent verifies with Samsung web engine spec; build target is one constant; compat-check list adjustable |
| AVPlay `extra_info` format differs | Parse defensively; Diagnostics shows raw track info so the first TV test tells us the real shape |
| Debrid proxy headers unsupported by AVPlay | Rank last + log; TorBox links normally need none |
| CORS on some add-ons / IntroDB | Fail soft; Diagnostics logs blocked hosts |
| Weak CPU → slow UI | Virtualised rows, transform-only animation, image priority loader, perf pass with 4× throttle |
| Can't test real AVPlay here | Mock covers logic; real-device behaviour validated in section 8 with Diagnostics |
| DTS-only releases for a title | Shown last with "No sound on this TV"; future `resolvePlayableUrl` transcode hook |

## 10. Code hosting
Developed in `/home/claude/alder-tizen` (git). To publish: owner creates an empty GitHub repo (e.g. `esedmemmed/alder-tizen`), Opus attaches it with push access and pushes `main`; `Alder.wgt` then also goes to GitHub Releases.
