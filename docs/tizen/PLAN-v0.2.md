# Alder for Tizen 0.2.0 — plan

Owner feedback on 0.1.0 (first TV run, 2026-10-29): sign-in, profiles and streaming work well ("better than Stremio").
Two issues:
1. **Focus is hard to follow.** Moving between tabs and buttons (top nav Home/Shows/Movies/My List, profile, search,
   Play/subtitle buttons) only shows a small dot or a faint rim. On a TV from a sofa you lose track of where you are.
   Wanted: Netflix-like, obvious focus with a background colour and smooth transitions.
2. **Some films don't fill the screen.** Player uses AVPlay LETTER_BOX (fit, never crop), so 2.39:1 films show black bars —
   probably the source, but the owner can't tell. Make it visible and give a choice.

## A. Focus treatment (agent "focus", Sonnet)

One focus language, applied everywhere, defined once in `src/ui/styles/tokens.css` + `components.css`:

| Element | Focused | Current/selected, not focused | Idle |
|---|---|---|---|
| Top nav tabs (Search, Home, Shows, Movies, Live, My List) | **Solid warm-white pill behind the label** (`--focus-fill` ≈ #F2E8D8), dark text (`--focus-ink` ≈ #15110E); the pill **slides** to the focused tab (one highlight element moved with `transform: translateX()` + width via `scaleX` or pre-measured widths, 180 ms ease-out) | Translucent fill (white ~14%) + bold label; dot kept | Plain label 70% |
| Chips (genres, My List filters/sort, settings values) | Solid warm-white fill, dark text, scale 1.04 | Translucent fill + dot | Outline only |
| Round icon buttons (profile avatar, player controls, title-page buttons) | Filled warm-white circle, dark icon, scale 1.10, **label shown under it** | — | Dark glass circle, light icon |
| Primary pill buttons (Play/Resume) | Already filled; add scale 1.06 + stronger glow | — | — |
| List rows (Settings sidebar + rows, Sources rows, Audio & subtitles rows, menus, Add-ons, profile menu) | Solid warm-white row background, dark text (tags/secondary text recoloured to stay readable) | Tick / dot kept | Plain |
| Cards | Unchanged (tungsten rim + 1.08) | | |
| Keyboard keys, PIN boxes | Solid warm-white key, dark glyph | | |

Rules:
- Animate only `transform` and `opacity` (TU8000 budget): fills fade in via a `::before` layer's opacity, the nav highlight moves by transform. No box-shadow animation, no blur, no layout properties in transitions. Durations 120–180 ms.
- Contrast: focused text ≥ 7:1 against `--focus-fill`; check every secondary text colour inside a focused row/chip.
- Keep Alder's palette and fonts; only the focus state changes. Record the deviation from Alder in DECISIONS.md (Alder uses rim/tint; owner asked for filled focus).
- Must not break the focus engine (`src/lib/focus.js`) or row virtualisation.

Paths: `src/ui/styles/*.css`, `src/ui/screens-b/screens-b.css`, `src/player/player.css`, `src/ui/*.js` (component markup only, e.g. the nav highlight element and button labels), `src/screens/home.js` (top bar only), `dev/scenarios/v02-focus.mjs`. **Not**: `src/player/*.js`, `src/screens/settings.js` (the player agent works there).

Acceptance: screenshots at 1920×1080 of every focus state listed above (shots/v02/focus-*.png), focus move still < 50 ms at 4× throttle, all existing scenarios green.

## B. Picture size + "is it the source?" (agent "picture", Sonnet)

1. Research Samsung AVPlay `setDisplayMethod` modes (developer.samsung.com AVPlay API reference): which modes exist on Tizen 5.5 (LETTER_BOX, FULL_SCREEN, AUTO_ASPECT_RATIO, …), what each does (fit / stretch / crop). Decide:
   - Default **Fit**: keep aspect. If AUTO_ASPECT_RATIO handles anamorphic sources (non-square pixels) better than LETTER_BOX, use it as Fit.
   - **Fill (zoom)**: fill the screen by cropping, never stretching — if AVPlay has no crop mode, emulate with `setDisplayRect` larger than the screen (centred, negative offsets) if the API accepts it, else via `setVideoRoi` if available on 5.5. If neither works, do **not** offer stretch; ship Fit only and say so.
2. Player: a "Picture" row in Audio & subtitles (Fit / Fill), applied at once at the same second; per-profile default in Settings → Picture & Sound ("Picture size"). Remember choice.
3. Show the source shape: player Info (the (i) button on the controls) and Diagnostics show the video's resolution and aspect from the VIDEO track's extra_info (e.g. "1920×800 · 2.40:1 · black bars are in the film") so the owner can tell bars come from the film.
4. Tests for mode selection and aspect text; mock supports the chosen modes; screenshots shots/v02/picture-*.png.

Paths: `src/player/*.js` (not player.css), `src/core/settings.js`, `src/screens/settings.js`, `src/screens/diagnostics.js`, `dev/mock-tizen.js`, `test/player/`, `test/core/`, `dev/scenarios/v02-picture.mjs`.

## C. Release (manager)
Review both, run everything, version **0.2.0** (config.xml, package.json), build, `release/Alder.wgt` + `release/README.md` table, push. CHANGELOG.md entry.

---

## D. Player fixes and polish (agent "player-polish", Sonnet) — after A and B are merged

Owner's TV photo (0.1.0, 2026-10-29): player control buttons are **empty circles** — no icons (Play/Pause, subtitles,
layers, next episode, info). The "Play" label shows, so the buttons exist; the inline SVG icons do not render on the TV's
Chromium M69 engine although they render in desktop Chromium.

1. **Icons that render on the TV.** Find the M69 cause if you can (inline `<svg>` via innerHTML in `src/ui/icons.js` +
   `.icon svg {width:100%;height:100%}` in base.css). Whatever the cause, make icons robust everywhere (player, title page,
   top nav search, menus, cards): e.g. `<svg>` with explicit `xmlns`, `width`/`height` attributes and `viewBox`, created
   with `document.createElementNS` instead of innerHTML, and a fixed-size wrapper; or data-URI SVG `<img>` per colour.
   Pick the approach least likely to fail on M69 and record why in DECISIONS.md. Add an "Icons" line to Diagnostics that
   draws every icon in a row, so a TV photo shows at once whether icons render.
2. **Back to Play/Pause.** Whenever the controls are shown — after closing Audio & subtitles (Back), after a seek, after
   any panel or card (Up Next, stall offer, sources) closes, and every time the controls reappear — focus returns to the
   Play/Pause button. OK on Play/Pause toggles. While the controls are hidden, OK = show controls with Play/Pause focused;
   the Play/Pause media key toggles at once without showing the full controls.
3. **Centre play/pause glyph (Netflix-like).** On pause: a large clean pause/play glyph in a dark translucent circle at the
   centre of the picture, fading in 120 ms; on resume: a short play glyph that fades out after ~600 ms. Transform/opacity
   only.
4. Keep everything Alder-consistent otherwise (controls layout, labels). Tests for the focus-return rules (non-DOM where
   possible) and screenshots `shots/v02/player-*.png` (controls with icons focused/unfocused, centre glyph paused, after
   closing options focus on Play/Pause).

Paths: `src/ui/icons.js`, `src/ui/styles/base.css` (icon rules only), `src/player/*`, `src/screens/diagnostics.js`,
`test/player/`, `dev/scenarios/v02-player.mjs`.

## E. Faster, smoother page switching (agent "pages", Sonnet) — after A is merged

Owner: switching Home ↔ Shows ↔ Movies ↔ My List is "not so fast". Measure first at 4× CPU throttle (time from the key
press on a nav tab to the new page's first row painted, and to the hero art), then:
- Switch instantly to the page's saved answer (kept catalogs) and fade/slide the rows in (transform/opacity, ≤ 180 ms);
  fetch fresh in the background and patch rows without rebuilding the page.
- Keep built pages alive (hidden) after the first visit instead of rebuilding them, within the card-node budget
  (virtualise off-screen pages).
- Debounce: moving across tabs quickly must not build every page in between (build after ~150 ms on a tab, or on OK).
- Pre-warm Shows and Movies catalogs after Home settles (Alder's `warmPages`).
Target: tab switch to first row < 150 ms at 4× throttle from kept answers. Report before/after numbers.
Paths: `src/screens/home.js`, `src/app/home-model.js`, `src/ui/row.js`, `src/ui/styles/home.css`, `test/app/`,
`dev/scenarios/v02-pages.mjs`.

### D addendum (2026-10-29, owner's TV photos)
- Icons render on Home and the title page but not in the player: the player inserts the `<svg>` straight into the flex
  `.pl-btn` with no sized `.icon` wrapper, so on M69 it collapses to 0×0. Fix by always wrapping + a regression check.
- Back at the bottom of the stack must ask "Exit Alder?" (Stay focused by default / Exit) instead of closing at once.
