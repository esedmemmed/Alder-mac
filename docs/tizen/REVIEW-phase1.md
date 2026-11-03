# Review — Phase 1 (foundation)

Verdict: **PASS** with one carry-over.

Checked by the manager:
- `npm test` 300/300, `npm run compat` 0 errors, `npm run build` → dist/Alder.wgt, `scripts/verify-wgt.mjs` exit 0 (all run independently).
- config.xml: 10-char package id `AldrTizen0`, required_version 5.5, public privileges only (internet, tv.inputdevice, productinfo), `$WEBAPIS/webapis/webapis.js` included (needed for AVPlay on the TV) and swapped for the mock in dev builds.
- Screenshots vs Alder `docs/home-dune.png`: layout, type, nav pill, Continue row, progress bars, "Stopped at" pill and next-row hint match. Placeholder art only because the workspace has no image network.
- Decisions accepted: Chromium M69 target; dp×2 scale (from Alder's own screenshots, supersedes PLAN's ×1.5); card growth 1.08 (Alder's constant); bundled OFL fonts; index-based row movement.

Carry into Phase 4:
- Panels/menus (`ui/panel.js`): background too translucent, text behind bleeds through (shots/phase1/08-options-panel.png). Without blur the glass needs ~92–95% opacity of the dark base.
