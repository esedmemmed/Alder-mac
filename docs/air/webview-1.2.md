# Web view on the Air, phase 1.2

What the app's WKWebView on the 2014 Air (Big Sur) offers Alder. Raw: `docs/air/raw-1.2/ui-report.txt` (never edited). Run 2026-11-03, `PY air/run_from_windows.py` probe mode, two launches (probe 1, probe 2 after a relaunch). No links, no keys.

## Engine
- WebKit 605.1.15 (UA `AppleWebKit/605.1.15`; Safari version not reported by WKWebView). Big Sur class, Safari 14 era: the build target `safari14` stays.

## Network from `alder://app`
- Every probed host reached with `fetch`, status 200, both launches: api.strem.io, link.stremio.com, Cinemeta, OpenSubtitles v3, Torrentio.
- binding: no CORS refusal under the custom scheme, so requests stay in `src/lib/http.js` (`window.fetch`); T8 (native fetch) builds nothing.

## Storage
- `localStorage` written in probe 1, present after relaunch in probe 2: kept across relaunch. Sign-in and settings can live there as on Tizen.

## Missing features (absent in this WebKit)
- JS: `Object.hasOwn`, `Array.prototype.at`, `Array.prototype.findLast`, `Array.prototype.toSorted`, `structuredClone`.
- CSS: `aspect-ratio`, `:focus-visible`, unprefixed `backdrop-filter` (`-webkit-backdrop-filter` works).
- Present: Promise.allSettled/any, Object.fromEntries, replaceAll, matchAll, globalThis, WeakRef, grid, sticky, `inset`.
- Guard: `scripts/compat-check.mjs` JS_RULES (`Object.hasOwn`, `.at()`, `findLast`, `toSorted`, `structuredClone`) and CSS_RULES (`aspect-ratio`, `:focus-visible`, `backdrop-filter`) flag all of them; it scans `src/`, `mac/web/alder-index.html` and `dist-mac/`. On 2026-11-03 `npm run build:mac` then `npm run compat`: 96 files, 0 errors: the Mac build uses none of them.
