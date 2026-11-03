# Results 1.3

## Periodic hitch

Seen with app-7a8efb9 on the 2014 Air: windowed 1080p H.264 23.976, a hitch of about 0.5 s every ~10 s. Bare mpv on the same file is clean (realtime 0.998).

Reasoning (R1.3-006). The shell called `mpv_render_context_report_swap(rc)` right after `glFlush()` in `RenderCore.draw` (mac/shell/VideoView.swift). glFlush is not the vsync, and the CAOpenGLLayer is presented by CoreAnimation later, so the reported swap times do not match what the screen shows. render.h says report_swap used inconsistently makes playback bad. With video-sync at its default (audio) mpv still uses those times for its frame-timing estimate, so a wrong source can disturb it.

Change (T8.1.c1): the call is commented out (`// was: ...` kept, with why). video-sync stays at the default (audio); no display-* mode and no interpolation, because both need a real vsync source and this host has none (comment in mac/shell/main.swift). Expected effect: no ~10 s hitch on the next Air run, frame drops no worse than before. Swift is not compiled on Windows: the effect is unmeasured until the Air builds it.

Second hypothesis if the hitch stays: the engine's progress record, `TICK = 10000` (src/core/playback.js:7), writes the library item every 10 s (every 6th also pushes to Stremio, PUSH_EVERY). The period matches. Watch for: a hitch that lines up with the tick (stats/log timestamps of the record against the hitch), a hitch with the app's page idle, and whether the same hitch appears with `--play-check` (same engine) versus the bare-mpv shell path. If it follows the tick, the cost is on the page (JS or storage write) or the bridge round trip, not the render path; try the record off for one run.

## Player keys

The Mac build's table is `KEY_ACTIONS` in src/platform/mac/keys.js. Path: window keydown/keyup -> `attachKeys` -> `router.onKey` -> player screen `onKey` (src/player/screen.js, with `macFullscreenKey` patched in ahead of `mediaKey` by scripts/build.mjs) -> `controls.key` (src/player/controls.js) or `options.key` while the panel is open.

- Space: play/pause (always, and shows the glyph).
- Left / Right: controls hidden: show the bar and seek -/+10 s (the seek is sent 600 ms after the last press). Controls up on the bar: seek -/+10 s, 30 s, 60 s while held. Elsewhere on the controls: move between the buttons.
- Up / Down: controls hidden: bring them up on Play/Pause. Up: to the bar; Down: from the bar to Play/Pause.
- Return: OK. Hidden: play/pause and show the controls. On a button: runs it (Audio & subtitles opens the options panel; Stream, Next, Info). Hold: only OK holds.
- Esc and Backspace: back. Closes a card or the options panel, hides the controls, then leaves the player. Esc leaves fullscreen first.
- F: fullscreen on/off (not with Cmd/Ctrl/Alt). E: Diagnostics export. ] and [: fast-forward / rewind 10 s. 0-9: digits.
- There is no direct key to the audio or subtitle menu: Left, Left from Play/Pause reaches the Audio & subtitles button, Return opens the panel.

Tested on Windows (test/platform/mac.player-keys.test.js, real Mac key table and dispatcher, real engine on the mpv model, the DOM-free rules): Space, Left/Right/] seeks, Up/Down focus, Left-Left-Return to the options and Esc back out, F and Esc with fullscreen. Not tested (needs a DOM): the options panel rows and their keys, the button highlight, the real screen object.

Play-check finding (why only Space worked). Not reproduced here and the log of that run was not read; by reading, the Mac key table and the screen path accept every key above, and the mock chain passes them all. Two things stand out. (1) A real defect, fixed (T8.1.c1): the play-check hook asked the shell for fullscreen (`fs=1`) straight through the bridge, so the lifecycle believed the window windowed; the first F asked for fullscreen again (nothing visible) and Esc left the player instead of leaving fullscreen. `installPlayHook` now tells the lifecycle (`macNoteFullscreen`). (2) Left/Right do nothing when the engine has no length or thinks the stream is live (`engine.scrub` returns at once; src/player/engine.js:778): `live` and `duration` are read once after prepare from mpv's `duration` property. If that had not arrived by then, seek keys are dead for the whole playback; Up/Down/Return only change the on-screen controls, which are easy to miss over a video. Check on the next Air run: the log line `prepared: N s` (0 s or `(live)` means the second case).

## Known defects

- The `--play-check` summary line for the app is empty. Noted, not fixed.
