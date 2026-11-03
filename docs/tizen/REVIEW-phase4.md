# Review — Phase 4 (screens, 4A + 4B)

Verdict: **PASS**.

Checked by the manager:
- `npm test` 453/453, compat 0 errors (77 files), build OK (Alder.wgt 452.7 KB), `npm run shots` 52/52 (all scenarios on the real main.js, run independently).
- Screens vs Alder docs/: sign-in (link code + QR), picker (docs/picker.jpg), Home/Shows/My List, title page (title.png), Sources (sources.jpg: BEST MATCH, quality/release/tags/provider/size, "No sound on this TV"), Settings (settings.jpg), Search, Add-ons. Ids on cards/heroes are the fixture server's placeholder art.
- Contract docs/CONTEXT.md honoured: session services, screen names, player onNavigate (sources/next/details/exit), streams params via `playerParams` (resumeAt, startOver, nextVideoId/afterVideoId, maxHeight).
- TEMP demo code removed. Panels near-opaque, no backdrop-filter.
- Perf (4× CPU throttle): focus move ~3 ms, key→frame ~36 ms avg / 152 ms worst; ≤ 24 card nodes alive.

Carry into Phase 5:
- Fast Back race: popping the player within ~200 ms of mount throws in the AVPlay mock (timer outliving close()). Verify the engine/avplay wrapper can't hit the same on a TV (cancel all timers/listeners on close, ignore late callbacks).
- Missing fixtures: `subs.fixture.test/dune2/*` files referenced by OpenSubtitles fixtures.
- Stale "the demo reaches it" comments in src/screens/diagnostics.js and src/player/screen.js.
